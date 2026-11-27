"""Run: python -m src.pruebas_v12"""
from __future__ import annotations
import unittest, joblib, numpy as np,pandas as pd
from .caracteristicas import ROOT,TARGET,TIME,SENSORS,BASE,DYNAMIC,load_development,folds,features_instant
from .predecir_v12 import BUNDLE, predict_df,history_by_lot
from .validar_hach_v12 import evaluate

class TestsV12(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.data,cls.audit=load_development()
  cls.bundle=joblib.load(BUNDLE)
  cls.sample=cls.data.iloc[50:74][[TIME]+SENSORS].copy().reset_index(drop=True)
  cls.sample['lote_id']='Unico'

 def test_audit_counts(self):self.assertEqual(self.audit['registros_csv'],31163)
 def test_four_sensors(self):self.assertEqual(len(SENSORS),4)
 def test_instant_features(self):self.assertEqual(len(BASE),9)
 def test_temporal_features(self):self.assertEqual(len(DYNAMIC),21)
 def test_never_label_as_feature(self):self.assertNotIn(TARGET,DYNAMIC)
 def test_previous_models_kept(self):self.assertEqual(set(self.bundle['v11_models']),{'base','dynamic','huber','depth7'})
 def test_version(self):self.assertEqual(self.bundle['version'],'v12-experimental')
 def test_no_alarm(self):self.assertTrue(self.bundle['no_automatic_alerts']);self.assertFalse(predict_df(self.sample,self.bundle).apto_alerta_automatica.any())
 def test_predictions_nonnegative(self):
  p=predict_df(self.sample,self.bundle);self.assertTrue(np.isfinite(p.OD_estimado_mg_L).all());self.assertTrue((p.OD_estimado_mg_L>=0).all())
 def test_previous_ref_available(self):
  p=predict_df(self.sample,self.bundle)
  self.assertTrue(np.isfinite(p.OD_v10_referencia_mg_L).all());self.assertTrue(np.isfinite(p.OD_v11_referencia_mg_L).all())
 def test_correct_v12_mix(self):
  p=predict_df(self.sample,self.bundle);x=history_by_lot(features_instant(self.sample))
  i=11;r=x.iloc[[i]];ref=r['sat_salobre_proxy_BK_mg_L'].to_numpy()[0]
  a=np.maximum(0,self.bundle['v11_models']['huber'].predict(r[DYNAMIC])[0]+ref)
  b=np.maximum(0,self.bundle['v11_models']['depth7'].predict(r[DYNAMIC])[0]+ref)
  c=np.maximum(0,self.bundle['huber_delta15'].predict(r[DYNAMIC])[0]+ref)
  self.assertAlmostEqual(p.OD_estimado_mg_L.iat[i],.25*a+.25*b+.5*c,places=10)
 def test_fallback_single(self):
  p=predict_df(self.sample.iloc[[0]],self.bundle)
  self.assertEqual(p.modo.iat[0],'v5_respaldo_sin_historial')
 def test_has_history(self):
  p=predict_df(self.sample,self.bundle)
  self.assertEqual(p.modo.iat[6],'v12_huber_delta15_temporal_experimental')
 def test_no_future(self):
  x=self.sample.copy();a=predict_df(x,self.bundle)
  x.loc[20,'pH']=8.5;b=predict_df(x,self.bundle)
  np.testing.assert_allclose(a.OD_estimado_mg_L.iloc[:20],b.OD_estimado_mg_L.iloc[:20])
 def test_not_use_hach(self):
  x=self.sample.copy();a=predict_df(x,self.bundle)
  x['OD_Hach_mg_L']=2.1;b=predict_df(x,self.bundle)
  np.testing.assert_allclose(a.OD_estimado_mg_L,b.OD_estimado_mg_L)
 def test_lot_history_isolation(self):
  x=self.sample.copy();x.lote_id=['A' if i%2==0 else 'B' for i in range(len(x))]
  r=predict_df(x,self.bundle)
  self.assertTrue((r.modo=='v5_respaldo_sin_historial').all())
 def test_empty_lot_rejected(self):
  x=self.sample.copy();x.loc[0,'lote_id']=''
  with self.assertRaises(ValueError):predict_df(x,self.bundle)
 def test_training_range_warning(self):
  x=self.sample.iloc[[0]].copy();x.loc[0,'pH']=12.9
  self.assertTrue(predict_df(x,self.bundle).fuera_de_distribucion_aproximado.iat[0])
 def test_joint_distance_finite(self):self.assertTrue(np.isfinite(predict_df(self.sample,self.bundle).distancia_multivariante).all())
 def test_invalid_temp_rejected(self):
  x=self.sample.iloc[[0]].copy();x.loc[0,'temperatura_agua_C']=-10
  with self.assertRaises(ValueError):predict_df(x,self.bundle)
 def test_duplicate_date_rejected(self):
  x=pd.concat([self.sample,self.sample.iloc[[0]]],ignore_index=True)
  with self.assertRaises(ValueError):predict_df(x,self.bundle)
 def test_hach_by_timestamp_and_lot(self):
  x=self.sample.copy();x['OD_Hach_mg_L']=np.linspace(4,7,len(x))
  p,r=evaluate(x.sample(frac=1,random_state=1),self.bundle)
  ref=x.set_index(TIME)['OD_Hach_mg_L'];self.assertEqual(len(p),len(x))
  for _,q in p.iterrows():self.assertAlmostEqual(q.OD_Hach_mg_L,ref.loc[q[TIME]])
 def test_hach_rollback_comparison(self):
  x=self.sample.copy();x['OD_Hach_mg_L']=5.5
  pred,report=evaluate(x,self.bundle)
  fair=report['comparacion_mismas_filas_con_6h']
  self.assertEqual(set(fair),{'v5','v10','v11','v12'})
  self.assertGreater(report['lotes_con_6h'],0)
 def test_hach_does_not_change_prediction(self):
  x=self.sample.copy();x['OD_Hach_mg_L']=1
  p,_=evaluate(x,self.bundle);x['OD_Hach_mg_L']=9
  q,_=evaluate(x,self.bundle)
  np.testing.assert_allclose(p.OD_estimado_mg_L,q.OD_estimado_mg_L)
 def test_no_hach_invalid(self):
  with self.assertRaises(ValueError):evaluate(self.sample,self.bundle)
 def test_purge(self):
  for _,a,b,_,_ in folds(self.data):
   self.assertLess(self.data.iloc[a][TIME].max()+pd.Timedelta(hours=24),self.data.iloc[b][TIME].min())
 def test_dataset_exposed_end_excluded(self):
  self.assertLess(self.data[TIME].max(),pd.to_datetime(self.audit['inicio_test_expuesto'],utc=True))
 def test_mae_improves_each_fold_vs_v10(self):
  f=pd.read_csv(ROOT/'resultados/cv_folds_v12.csv').pivot(index='fold',columns='modelo',values='MAE')
  self.assertTrue((f.v12<f.v10).all())
 def test_low_oxygen_caveat(self):
  d=pd.read_csv(ROOT/'resultados/diagnostico_od_bajo_v12.csv').set_index('modelo')
  self.assertGreater(d.loc['v12','bajo_no_detectado'],d.loc['v10','bajo_no_detectado'])

if __name__=='__main__':unittest.main(verbosity=2)
