"""Calibración SIMULADA; no modifica el dashboard ni la configuración real."""
import unittest
from validation import validate_settings,reference
from worker import Engine
from src.fisica_benson import saturacion_benson_krause

def settings(**changes):
 c={'sensor':'SEN0237','confirmed':True,'mode':'zero_span','voltage1Mv':1600,'temperature1C':25,'zeroVoltageMv':100,'zeroTemperatureC':25,'temperatureToleranceC':.5,'calibrationPressureHpa':1013.25,'salinityMode':'freshwater'}
 c.update(changes)
 return {'lotId':'SIMULADO-CERO-SPAN','validationEnabled':True,'calibration':c}

class ZeroSpan(unittest.TestCase):
 def test_zero_midpoint_and_full_scale(self):
  s=validate_settings(settings());sat=float(saturacion_benson_krause(25,0,1013.25))
  for voltage,fraction in [(0.1,0),(0.85,.5),(1.6,1)]:
   result,reason=reference({'temperature':25,'pressure':1013.25,'odVoltageV':voltage},s,saturacion_benson_krause)
   self.assertAlmostEqual(result,fraction*sat);self.assertIn('zero_span',reason)
 def test_temperature_gate_no_fabricated_thermal_curve(self):
  result,reason=reference({'temperature':27,'pressure':1013.25,'odVoltageV':1.6},validate_settings(settings()),saturacion_benson_krause)
  self.assertIsNone(result);self.assertIn('temperatura',reason)
 def test_invalid_endpoints_and_temperature(self):
  for changes in [{'zeroVoltageMv':1600},{'zeroVoltageMv':1700},{'zeroVoltageMv':1599.5},{'zeroVoltageMv':-1},{'zeroTemperatureC':27},{'temperatureToleranceC':3},{'zeroVoltageMv':None},{'temperatureToleranceC':True}]:
   with self.subTest(changes=changes),self.assertRaises(ValueError):validate_settings(settings(**changes))
 def test_below_zero_is_missing_not_clipped(self):
  result,reason=reference({'temperature':25,'pressure':1013.25,'odVoltageV':.05},settings(),saturacion_benson_krause)
  self.assertIsNone(result);self.assertIn('inferior',reason)
 def test_above_span_is_explicit(self):
  result,reason=reference({'temperature':25,'pressure':1013.25,'odVoltageV':2},settings(),saturacion_benson_krause)
  self.assertIsNotNone(result);self.assertIn('extrapolación',reason)
 def test_storage_metrics_method_csv_and_unchanged_ml(self):
  import tempfile
  from pathlib import Path
  with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'.local') as temp:
   engine=Engine(Path(temp)/'test.sqlite')
   try:
    raw={'at':'2020-01-01T12:00:00.000Z','temperature':25,'pressure':1013.25,'ph':7,'conductivity':1.3,'odVoltageV':.85}
    before=engine.predict(raw,'SIMULADO-CERO-SPAN')['predictionMgL']
    engine.configure(settings());one=engine.ingest(raw)
    self.assertEqual(one['latest']['calibrationMode'],'zero_span');self.assertEqual(one['metrics']['n'],1)
    self.assertEqual(one['latest']['predictionMgL'],before)
    self.assertIn('calibration_method',engine.export());self.assertIn('zero_span',engine.export())
    self.assertEqual(engine.db.execute('SELECT count(*) FROM calibrations').fetchone()[0],1)
    engine.configure(settings(voltage1Mv=1700));self.assertEqual(engine.snapshot()['metrics']['n'],0)
    self.assertEqual(engine.db.execute('SELECT count(*) FROM calibrations').fetchone()[0],2)
   finally:engine.db.close()

if __name__=='__main__':unittest.main(verbosity=2)
