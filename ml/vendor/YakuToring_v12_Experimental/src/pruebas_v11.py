"""Verificación reproducible del flujo v11: python -m src.pruebas_v11."""
from __future__ import annotations
import unittest
import joblib,numpy as np,pandas as pd
from .caracteristicas import ROOT,TIME,TARGET,SENSORS,BASE,DYNAMIC,REFERENCE,features_instant,add_causal_history,load_development,folds
from .predecir_v11 import predict_df
from .validar_hach_v11 import evaluate

class TestsV11(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df,cls.audit=load_development()
        cls.bundle=joblib.load(ROOT/'modelos/yakutoring_v11.joblib')
        cls.sensor_example=cls.df.iloc[50:75][[TIME]+SENSORS].copy().reset_index(drop=True)

    def test_dataset_original(self):self.assertEqual(self.audit['registros_csv'],31163)
    def test_historical_coverage(self):self.assertEqual(len(self.df),5642)
    def test_target_not_feature(self):
        self.assertNotIn(TARGET,BASE)
        self.assertNotIn(TARGET,DYNAMIC)
    def test_feature_count(self):self.assertEqual((len(BASE),len(DYNAMIC)),(9,21))
    def test_chronological_folds_purged(self):
        for _,train,val,_,_ in folds(self.df):
            self.assertLess(self.df.iloc[train][TIME].max()+pd.Timedelta(hours=24),self.df.iloc[val][TIME].min())
    def test_exposed_end_excluded(self):
        cutoff=pd.to_datetime(self.audit['inicio_test_expuesto'],utc=True)
        self.assertLess(self.df[TIME].max(),cutoff)
    def test_no_future_information(self):
        d=self.sensor_example.copy();pred0=predict_df(d,self.bundle)
        d.loc[23,'pH']=8.5
        pred1=predict_df(d,self.bundle)
        np.testing.assert_allclose(pred0['OD_estimado_mg_L'].iloc[:23],pred1['OD_estimado_mg_L'].iloc[:23])
    def test_fallback_single(self):
        out=predict_df(self.sensor_example.iloc[[0]],self.bundle)
        self.assertEqual(out.modo.iat[0],'v5_instantaneo_sin_historial')
    def test_v11_after_six_hours(self):
        out=predict_df(self.sensor_example,self.bundle)
        self.assertEqual(out.modo.iat[6],'v11_huber_depth7_experimental')
    def test_label_not_used(self):
        x=self.sensor_example.copy();p0=predict_df(x,self.bundle)
        x[TARGET]=np.arange(len(x))
        p1=predict_df(x,self.bundle)
        np.testing.assert_allclose(p0.OD_estimado_mg_L,p1.OD_estimado_mg_L)
    def test_out_of_training_range_flag(self):
        x=self.sensor_example.iloc[[0]].copy();x.loc[0,'pH']=13
        out=predict_df(x,self.bundle)
        self.assertTrue(out.fuera_rango_historico.iat[0])
    def test_date_duplicates_invalid(self):
        x=pd.concat([self.sensor_example,self.sensor_example.iloc[[0]]],ignore_index=True)
        with self.assertRaises(ValueError):features_instant(x)
    def test_invalid_sensor(self):
        x=self.sensor_example.copy();x.loc[0,'temperatura_agua_C']=-5
        with self.assertRaises(ValueError):features_instant(x)
    def test_nonnegative_finite(self):
        x=predict_df(self.sensor_example,self.bundle)
        self.assertTrue(np.isfinite(x.OD_estimado_mg_L).all())
        self.assertTrue((x.OD_estimado_mg_L>=0).all())
    def test_model_matches_manual_ensemble(self):
        x=self.sensor_example.copy();d=add_causal_history(features_instant(x))
        r=d.iloc[[15]][REFERENCE].to_numpy()[0];m=self.bundle['models']
        h=np.maximum(0,m['huber'].predict(d.iloc[[15]][DYNAMIC])[0]+r)
        d7=np.maximum(0,m['depth7'].predict(d.iloc[[15]][DYNAMIC])[0]+r)
        out=predict_df(x,self.bundle)
        self.assertAlmostEqual(out.OD_estimado_mg_L.iat[15],(h+d7)/2,places=9)
    def test_previous_v10_is_provided(self):
        x=predict_df(self.sensor_example,self.bundle)
        self.assertTrue(np.isfinite(x.OD_v10_referencia_mg_L).all())
        self.assertEqual(self.bundle['version'],'v11-experimental')
    def test_no_automatic_alarm(self):
        x=predict_df(self.sensor_example,self.bundle)
        self.assertFalse(x.apto_alerta_automatica.any())
    def test_hach_pairs_by_time(self):
        d=self.sensor_example.copy()
        d['lote_id']=['L-%02d'%(i//5) for i in range(len(d))]
        d['OD_Hach_mg_L']=np.arange(len(d))*.1+4
        out,report=evaluate(d.sample(frac=1,random_state=5))
        correct=d.set_index(TIME)['OD_Hach_mg_L']
        for _,r in out.iterrows():self.assertAlmostEqual(r.OD_Hach_mg_L,correct.loc[r[TIME]])
        self.assertEqual(report['lotes_independientes'],5)
    def test_hach_missing_rejected(self):
        d=self.sensor_example.copy()
        with self.assertRaises(ValueError):evaluate(d)
    def test_hach_not_retrained(self):
        d=self.sensor_example.copy();d['lote_id']='Prueba'
        d['OD_Hach_mg_L']=5.3
        p0=predict_df(d,self.bundle)
        d['OD_Hach_mg_L']=7.2
        p1=predict_df(d,self.bundle)
        np.testing.assert_allclose(p0.OD_estimado_mg_L,p1.OD_estimado_mg_L)
    def test_improves_dev_all_four(self):
        r=pd.read_csv(ROOT/'resultados/cv_folds_v11.csv')
        table=r.pivot(index='fold',columns='modelo',values='MAE')
        self.assertTrue((table['v11_huber_depth7']<table['v10_ensamble']).all())
    def test_file_risks_explicit(self):
        diag=pd.read_csv(ROOT/'resultados/diagnostico_riesgo_v11.csv').set_index('modelo')
        self.assertGreater(diag.loc['v11_huber_depth7','tasa_falsos_tranquilizadores'],
                           diag.loc['v10_ensamble','tasa_falsos_tranquilizadores'])

if __name__=='__main__':unittest.main(verbosity=2)
