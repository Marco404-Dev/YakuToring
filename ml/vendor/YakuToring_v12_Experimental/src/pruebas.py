"""Pruebas automatizadas sin acceso a la red. Ejecutar python -m src.pruebas."""
from __future__ import annotations
import unittest, numpy as np, pandas as pd,joblib
from .caracteristicas import ROOT,TIME,TARGET,SENSORS,BASE,DYNAMIC,REFERENCE,load_development,features_instant,add_causal_history,folds,metrics
from .predecir import predict_df
from .validar_hach import validate

class TestProyecto(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.d,cls.audit=load_development()
  cls.bundle=joblib.load(ROOT/'modelos'/'yakutoring_v10.joblib')
  cls.example=cls.d.iloc[80:100][[TIME]+SENSORS].copy().reset_index(drop=True)

 def test_registros(self): self.assertEqual(self.audit['registros_csv'],31163)
 def test_referencia_positiva(self): self.assertTrue((self.d[REFERENCE]>0).all())
 def test_no_od_como_predictor(self):
  self.assertNotIn(TARGET,BASE);self.assertNotIn(TARGET,DYNAMIC)
 def test_todas_features(self):self.assertTrue(set(DYNAMIC).issubset(self.d.columns))
 def test_cv_purga_24h(self):
  for _,itr,iva,_,_ in folds(self.d):
   self.assertLess(self.d.iloc[itr][TIME].max()+pd.Timedelta(hours=24),self.d.iloc[iva][TIME].min())
 def test_datos_excluidos(self):
  self.assertLess(self.d[TIME].max(),pd.to_datetime(self.audit['inicio_test_expuesto'],utc=True))
 def test_cambio_6h_causal(self):
  e=add_causal_history(features_instant(self.example))
  t=10
  self.assertAlmostEqual(e.loc[t,'d_pH_6h'],e.loc[t,'pH']-e.loc[t-6,'pH'],places=12)
 def test_sin_historial_caida_a_base(self):
  e=predict_df(self.example.iloc[[0]],self.bundle)
  self.assertEqual(e['modo'].iat[0],'v5_base_sin_historial')
 def test_con_historial_ensamble(self):
  e=predict_df(self.example,self.bundle)
  self.assertEqual(e['modo'].iat[10],'v10_ensamble_temporal')
 def test_no_usa_etiquetas(self):
  d=self.example.copy();p1=predict_df(d,self.bundle)
  d[TARGET]=999 # se IGNORA siempre en modo inferencia
  p2=predict_df(d,self.bundle)
  np.testing.assert_allclose(p1['OD_estimado_mg_L'],p2['OD_estimado_mg_L'])
 def test_desorden_ordenado(self):
  p1=predict_df(self.example,self.bundle)
  p2=predict_df(self.example.sample(frac=1,random_state=42),self.bundle)
  np.testing.assert_allclose(p1['OD_estimado_mg_L'],p2['OD_estimado_mg_L'])
 def test_fechas_repetidas(self):
  with self.assertRaises(ValueError): features_instant(pd.concat([self.example,self.example.iloc[[0]]]))
 def test_fecha_invalida(self):
  d=self.example.copy();d.loc[0,TIME]='no es fecha'
  with self.assertRaises(ValueError):features_instant(d)
 def test_conductividad_invalida(self):
  d=self.example.copy();d.loc[0,'conductividad_especifica_mS_cm']=-1
  with self.assertRaises(ValueError):features_instant(d)
 def test_diferencia_ahora_no_futura(self):
  d=self.example.copy();p=predict_df(d,self.bundle)
  future=d.copy();future.loc[19,'pH']=8.2
  q=predict_df(future,self.bundle)
  np.testing.assert_allclose(p['OD_estimado_mg_L'].iloc[:19],q['OD_estimado_mg_L'].iloc[:19])
 def test_prevision_no_negativa(self):
  self.assertTrue((predict_df(self.example,self.bundle)['OD_estimado_mg_L']>=0).all())
 def test_deteccion_fuera_training_range(self):
  d=self.example.iloc[[0]].copy();d.loc[d.index[0],'pH']=13.5
  q=predict_df(d,self.bundle);self.assertTrue(bool(q['fuera_del_rango_entrenamiento'].iat[0]))
 def test_hach_alineacion_por_fecha(self):
  d=self.example.copy();d['lote_id']='L001';d['OD_Hach_mg_L']=np.arange(len(d))+2.0
  # para n 20 se supera 30? no 2-21, dentro
  p,report=validate(d.sample(frac=1,random_state=30))
  self.assertEqual(len(p),len(d))
  # comparación de uniones exactas por fecha
  mapping=d.set_index(TIME)['OD_Hach_mg_L']
  for _,r in p.iterrows(): self.assertAlmostEqual(float(r['OD_Hach_mg_L']),float(mapping.loc[r[TIME]]))
 def test_metricas_error(self):
  m=metrics([2,4,6],[2,3,7]);self.assertAlmostEqual(m['MAE'],2/3)
 def test_resultados_guardados(self):
  r=pd.read_csv(ROOT/'resultados'/'ranking_v10.csv').set_index('modelo')
  self.assertAlmostEqual(r.loc['v5_reproducido','MAE_medio'],.720165,places=5)
  self.assertLess(r.loc['v10_ensamble_50','MAE_medio'],r.loc['v5_reproducido','MAE_medio'])

if __name__=='__main__':unittest.main(verbosity=2)
