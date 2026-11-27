"""Pruebas SIMULADAS en SQLite temporal; no insertan nada en el dashboard real."""
import unittest,tempfile,json,sys
from pathlib import Path
import numpy as np
import pandas as pd
from worker import Engine,wire,VENDOR,predict_df
from validation import reference,metrics,validate_settings
from src.fisica_benson import saturacion_benson_krause

def sample(at,**extra):return {'at':at,'temperature':27.5,'ph':7.07,'conductivity':1.363,'pressure':1012.8,'odVoltageV':None,**extra}

class Integration(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'.local')
  cls.engine=Engine(Path(cls.temp.name)/'test.sqlite')
 @classmethod
 def tearDownClass(cls):cls.engine.db.close();cls.temp.cleanup()
 def configure(self,lot):self.engine.configure({'lotId':lot,'validationEnabled':False,'calibration':None})
 def test_original_matches_v5_and_v12_and_persisted_history(self):
  self.configure('SIMULADO-comparacion')
  raw=[sample(f'2020-01-01T{h:02}:00:00.000Z') for h in range(7)]
  expected=predict_df(pd.DataFrame([wire(r,'SIMULADO-comparacion') for r in raw]),self.engine.bundle)
  actual=[self.engine.ingest(r)['latest'] for r in raw]
  np.testing.assert_allclose([r['predictionMgL'] for r in actual],expected.OD_estimado_mg_L,rtol=0,atol=1e-10)
  self.assertEqual(actual[0]['model'],'V5');self.assertEqual(actual[-1]['model'],'V12')
  restored=Engine(Path(self.temp.name)/'test.sqlite')
  try:self.assertEqual(restored.predict(sample('2020-01-01T06:00:00.000Z'),'SIMULADO-comparacion')['model'],'V12')
  finally:restored.db.close()
  evidence={'simulated':True,'source':'inferencias reales de artefacto entrenado; entradas sintéticas explícitas','modelSha256':self.engine.model_hash,'v5':actual[0],'v12':actual[-1],'maxDifferenceOriginal':float(np.max(np.abs(np.array([r['predictionMgL'] for r in actual])-expected.OD_estimado_mg_L.to_numpy())))}
  target=Path(__file__).resolve().parents[1]/'verification/ml-inference-simulated.json';target.write_text(json.dumps(evidence,indent=2,ensure_ascii=False),encoding='utf8')
 def test_no_reference_or_voltage_as_feature(self):
  a=sample('2020-02-01T12:00:00.000Z',odVoltageV=.1,OD_Hach_mg_L=1)
  b={**a,'odVoltageV':3,'OD_Hach_mg_L':20}
  self.assertEqual(wire(a,'SIMULADO'),wire(b,'SIMULADO'))
  self.assertEqual(self.engine.predict(a,'SIMULADO')['predictionMgL'],self.engine.predict(b,'SIMULADO')['predictionMgL'])
 def test_missing_inputs_and_lot_isolation(self):
  self.assertIsNone(self.engine.predict(sample('2020-01-01T06:00:00.000Z',temperature=None),'SIMULADO')['predictionMgL'])
  self.assertEqual(self.engine.predict(sample('2020-01-01T06:00:00.000Z'),'OTRO-LOTE')['model'],'V5')
  self.assertEqual(self.engine.predict(sample('2020-01-01T06:00:00.001Z'),'SIMULADO-comparacion')['model'],'V5')
 def test_calibration_gate_pressure_salinity_and_metrics(self):
  r=sample('2020-01-01T00:00:00Z',odVoltageV=1.6,temperature=25,pressure=1013.25)
  self.assertIsNone(reference(r,{'validationEnabled':True,'calibration':None},saturacion_benson_krause)[0])
  c={'sensor':'SEN0237','confirmed':True,'mode':'one_point','voltage1Mv':1600,'temperature1C':25,'calibrationPressureHpa':1013.25,'salinityMode':'freshwater'}
  s=validate_settings({'lotId':'SIMULADO','validationEnabled':True,'calibration':c})
  ref=reference(r,s,saturacion_benson_krause)[0];self.assertAlmostEqual(ref,float(saturacion_benson_krause(25,0,1013.25)))
  # El voltaje responde a pO2: no se multiplica dos veces la presión.
  self.assertAlmostEqual(reference({**r,'pressure':950},s,saturacion_benson_krause)[0],ref)
  self.assertLess(reference(r,{**s,'calibration':{**c,'salinityMode':'manual','salinityPpt':20}},saturacion_benson_krause)[0],ref)
  self.assertIsNone(reference({**r,'odVoltageV':None},s,saturacion_benson_krause)[0])
  m=metrics([(3,2),(5,6)]);self.assertEqual(m['n'],2);self.assertEqual(m['mae'],1);self.assertEqual(m['rmse'],1);self.assertIsNone(metrics([(1,2)])['r2'])
 def test_export_carries_original_voltage_and_units(self):
  self.assertIn('vod_V',self.engine.export());self.assertIn('modelo',self.engine.export())
 def test_reference_accumulation_and_calibration_versions(self):
  c={'sensor':'SEN0237','confirmed':True,'mode':'two_point','voltage1Mv':1600,'temperature1C':25,'voltage2Mv':1300,'temperature2C':15,'calibrationPressureHpa':1013.25,'salinityMode':'freshwater'}
  settings={'lotId':'SIMULADO-REFERENCIA','validationEnabled':True,'calibration':c}
  self.engine.configure(settings)
  a=self.engine.ingest(sample('2020-03-01T00:00:00.000Z',temperature=20,pressure=1013.25,odVoltageV=1.45))
  self.assertAlmostEqual(a['latest']['referenceMgL'],float(saturacion_benson_krause(20,0,1013.25)))
  self.assertEqual(a['metrics']['n'],1)
  b=self.engine.ingest(sample('2020-03-01T01:00:00.000Z',temperature=25,pressure=1013.25,odVoltageV=1.2))
  self.assertEqual(b['metrics']['n'],2);self.assertIsNotNone(b['metrics']['r2'])
  version=b['settings']['calibrationId']
  disabled=self.engine.configure({**settings,'validationEnabled':False})
  self.assertEqual(disabled['settings']['calibrationId'],version)
  self.assertEqual(disabled['metrics']['n'],2)
  paused=self.engine.ingest(sample('2020-03-01T02:00:00.000Z',odVoltageV=1.2))
  self.assertIsNone(paused['latest']['referenceMgL']);self.assertIsNotNone(paused['latest']['predictionMgL'])
  changed=self.engine.configure({**settings,'calibration':{**c,'voltage1Mv':1650}})
  self.assertNotEqual(changed['settings']['calibrationId'],version);self.assertEqual(changed['metrics']['n'],0)

if __name__=='__main__':unittest.main(verbosity=2)
