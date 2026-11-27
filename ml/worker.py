"""Proceso persistente JSONL por stdin/stdout: sin puerto HTTP ni secretos.
Modelos originales cargados una sola vez. SQLite mantiene el historial real.
"""
import sys,json,sqlite3,uuid,csv,io,hashlib,os
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
VENDOR=ROOT/'ml/vendor/YakuToring_v12_Experimental'
sys.path.insert(0,str(VENDOR))
import joblib
import pandas as pd
from src.predecir_v12 import predict_df
from src.caracteristicas import TIME,SENSORS,features_instant
from src.fisica_benson import saturacion_benson_krause
from validation import reference,metrics,validate_settings,number
from experimental_od import ExperimentalOD, DEMO
from environment_inference import predict as predict_environment
from datasets import Datasets
from comparison import Comparison, Models
from model_flags import enabled_models
from environment_registry import DEFAULT, REGISTRY

def wire(raw,lot):
    # Lista positiva: VOD, referencia OD, humedad y voltajes no pasan al ML.
    return {TIME:raw['at'],'lote_id':lot,**dict(zip(SENSORS,[raw.get(k) for k in ['temperature','ph','conductivity','pressure']]))}

class Engine:
    def __init__(self,db_path=None, enabled=True):
        self.bundle=joblib.load(VENDOR/'modelos/yakutoring_v12.joblib') if enabled else None
        self.model_hash=hashlib.sha256((VENDOR/'modelos/yakutoring_v12.joblib').read_bytes()).hexdigest() if enabled else None
        target=Path(db_path or os.environ.get('YAKUTORING_ML_DB_PATH') or ROOT/'.local/ml.sqlite');target.parent.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(target)
        self.db.execute('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS calibrations (id TEXT PRIMARY KEY, config TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS measurements (id INTEGER PRIMARY KEY, lot TEXT, time_ms INTEGER, raw TEXT, result TEXT, prediction REAL, reference REAL, calibration TEXT)')
        self.db.execute('CREATE INDEX IF NOT EXISTS history_time ON measurements(lot,time_ms)')
        row=self.db.execute('SELECT value FROM settings WHERE id=1').fetchone()
        self.settings=json.loads(row[0]) if row else {'lotId':'campo-principal','validationEnabled':False,'calibration':None,'calibrationId':None}
        self.latest=None
    def configure(self,s):
        s=validate_settings(s)
        s={k:s[k] for k in ['lotId','validationEnabled','calibration']}
        same=s['calibration']==self.settings.get('calibration')
        s['calibrationId']=(self.settings.get('calibrationId') if same else str(uuid.uuid4())) if s['calibration'] else None
        self.settings=s
        if s['calibrationId']:self.db.execute('INSERT OR IGNORE INTO calibrations VALUES(?,?)',(s['calibrationId'],json.dumps(s['calibration'])))
        self.db.execute('INSERT OR REPLACE INTO settings VALUES(1,?)',(json.dumps(s),));self.db.commit()
        self.latest=None
        return self.snapshot()
    def predict(self,raw,lot):
        current=wire(raw,lot)
        if any(not number(current.get(k)) for k in SENSORS):
            return {'predictionMgL':None,'model':None,'predictionStatus':'Faltan entradas válidas del ML: temperatura, pH, conductividad o presión'}
        stamp=int(pd.Timestamp(raw['at']).timestamp()*1000)
        frames=[]
        for lag in [6,3,1]:
            entry=self.db.execute('SELECT raw FROM measurements WHERE lot=? AND time_ms=? ORDER BY id DESC LIMIT 1',(lot,stamp-lag*3600000)).fetchone()
            if entry:
                obs=wire(json.loads(entry[0]),lot)
                if all(number(obs.get(k)) for k in SENSORS):
                    try:features_instant(pd.DataFrame([obs]));frames.append(obs)
                    except ValueError:pass
        frames.append(current)
        try:
            out=predict_df(pd.DataFrame(frames),self.bundle).iloc[-1]
            return {'predictionMgL':float(out.OD_estimado_mg_L),'model':'V12' if str(out.modo).startswith('v12') else 'V5','mode':str(out.modo),'predictionStatus':'Estimación experimental, no medición','outOfDistribution':bool(out.fuera_de_distribucion_aproximado),'warning':str(out.advertencia),'exactHistory':str(out.modo).startswith('v12'),'automaticAlerts':False}
        except ValueError as e:
            return {'predictionMgL':None,'model':None,'predictionStatus':str(e)[:240]}
    def ingest(self,raw):
        stamp=int(pd.Timestamp(raw['at']).timestamp()*1000)
        lot=self.settings['lotId'];prediction=self.predict(raw,lot)
        try:ref,reason=reference(raw,self.settings,saturacion_benson_krause)
        except (ValueError,OverflowError):ref,reason=None,'Fuera del dominio de la compensación física'
        p=prediction['predictionMgL']
        result={'at':raw['at'],'sequence':raw.get('packet'),'lotId':lot,**prediction,'referenceMgL':ref,'referenceStatus':reason,'odVoltageMv':raw['odVoltageV']*1000 if number(raw.get('odVoltageV')) else None,'absoluteError':abs(p-ref) if number(p) and number(ref) else None,'calibrationId':self.settings.get('calibrationId'),'calibrationMode':(self.settings.get('calibration') or {}).get('mode')}
        self.db.execute('INSERT INTO measurements(lot,time_ms,raw,result,prediction,reference,calibration) VALUES(?,?,?,?,?,?,?)',(lot,stamp,json.dumps(raw),json.dumps(result),p,ref,self.settings.get('calibrationId')));self.db.commit()
        self.latest=result
        return self.snapshot()
    def snapshot(self):
        lot=self.settings['lotId'];cal=self.settings.get('calibrationId')
        history=[json.loads(r[0]) for r in self.db.execute('SELECT result FROM measurements WHERE lot=? ORDER BY id DESC LIMIT 120',(lot,))][::-1]
        pairs=self.db.execute('SELECT prediction,reference FROM measurements WHERE lot=? AND calibration=? AND prediction IS NOT NULL AND reference IS NOT NULL',(lot,cal)).fetchall() if cal else []
        return {'status':'ready','modelVersion':'v12-experimental','modelSha256':self.model_hash,'settings':self.settings,'latest':self.latest or (history[-1] if history else None),'history':history,'metrics':metrics(pairs),'historyPolicy':'Coincidencias exactas 1/3/6 h del mismo lote; no se interpola ni inventa historial.','automaticAlerts':False}
    def export(self):
        buf=io.StringIO();writer=csv.writer(buf)
        writer.writerow(['timestamp_utc','lote_id','secuencia','temperature_C','pH','conductivity_mS_cm','pressure_hPa','ambient_C','humidity_pct','vph_V','vec_V','vod_V','OD_predicho_mg_L','modelo','OD_referencia_calculado_mg_L','error_absoluto_mg_L','calibration_id','reference_status','calibration_method'])
        for lot,raw,result in self.db.execute('SELECT lot,raw,result FROM measurements ORDER BY id'):
            r=json.loads(raw);p=json.loads(result)
            values=[r['at'],lot,r.get('packet'),*[r.get(k) for k in ['temperature','ph','conductivity','pressure','ambientTemperature','humidity','phVoltageV','ecVoltageV','odVoltageV']],p.get('predictionMgL'),p.get('model'),p.get('referenceMgL'),p.get('absoluteError'),p.get('calibrationId'),p.get('referenceStatus'),p.get('calibrationMode')]
            writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in values])
        return buf.getvalue()

def main():
    flags = enabled_models()
    engine = Engine(enabled='legacy' in flags)
    od = ExperimentalOD(engine.db, enabled='noaa' in flags)
    environment = os.getenv('YAKUTORING_MONITOR_ENVIRONMENT', DEFAULT)
    if environment not in REGISTRY['environments']:
        raise ValueError('Entorno de monitoreo desconocido.')
    automatic = REGISTRY['environments'][environment].get('artifacts') or {}
    comparison = Comparison(engine.db, Models(enabled=flags if automatic.get('catboost') else set(), environment=environment))
    models_by_env = {environment: comparison.models}
    datasets = Datasets(engine.db)
    live = None

    def with_od(snapshot):
        return {
            **snapshot,
            'activeModels': sorted(flags),
            'monitorEnvironment': environment,
            'liveOD': live,
            'provisionalEC': od.allow_provisional,
            'experimentalOd': od.snapshot(engine.settings['lotId']),
            'comparison': comparison.snapshot(),
        }

    print(json.dumps({'event':'ready','snapshot':with_od(engine.snapshot())},allow_nan=False),flush=True)
    for line in sys.stdin:
        message={}
        try:
            message=json.loads(line)
            op=message.get('op')
            if op=='ingest':
                row = message['row']
                snapshot = engine.ingest(row) if 'legacy' in flags else engine.snapshot()
                if 'noaa' in flags:
                    od.ingest(row, engine.settings['lotId'])
                reason = ('Dataset especializado pendiente de incorporación.' if not automatic.get('catboost')
                          else None if od.allow_provisional else 'La conductividad del dispositivo requiere validación antes de estimar OD.')
                if reason:
                    run = comparison.models.predict(row, blocked=reason)
                    run['status'] = reason
                else:
                    result = predict_environment(comparison.models, row, score_isolation=False, environment=environment)['predictions'][0]
                    run = result if 'models' in result else comparison.models.predict(row, blocked=result['status'])
                    run['status'] = result['status']
                    run['reason'] = result.get('reason')
                live = comparison.ingest(row, run)
                data = with_od(snapshot)
            elif op=='configure':data=with_od(engine.configure(message['settings']))
            elif op=='snapshot':data=with_od(engine.snapshot())
            elif op=='export':data={'csv':engine.export()}
            elif op=='od_demo':
                if 'noaa' not in flags: raise ValueError('Modelo histórico NOAA desactivado.')
                data={'demo':od.estimate(DEMO, demo=True)}
            elif op=='od_reference':
                od.reference(message['measurementId'], message['value'], engine.settings['lotId'])
                data = with_od(engine.snapshot())
            elif op=='experiment_create':
                comparison.create(message.get('name'))
                data = with_od(engine.snapshot())
            elif op=='experiment_sample':
                comparison.sample(message.get('sessionId'), message.get('runId'), message.get('metadata'))
                data = with_od(engine.snapshot())
            elif op=='experiment_reference':
                comparison.reference(message.get('sampleId'), message.get('value'), message.get('at'))
                data = with_od(engine.snapshot())
            elif op=='experiment_export':
                data = {'csv': comparison.export(message.get('sessionId'))}
            elif op=='comparison_runs':
                data = {'runs': comparison.runs(message.get('before'))}
            elif op=='environment_predictions':
                if message.get('noConductivity') and 'reduced' not in flags:
                    raise ValueError('CatBoost sin conductividad está desactivado.')
                chosen = message.get('environment', DEFAULT)
                if chosen not in models_by_env:
                    models_by_env[chosen] = Models(enabled=flags & {'catboost'}, environment=chosen)
                data = predict_environment(models_by_env[chosen], message.get('row'), message.get('csv'),
                                           message.get('noConductivity', False), environment=chosen)
            elif op=='datasets_list':
                data = datasets.list()
            elif op=='datasets_add':
                data = datasets.save(message.get('name'), message.get('origin'), message.get('csv'))
            elif op=='datasets_get':
                data = datasets.get(message.get('key'), message.get('page'), message.get('search', ''))
            else:raise ValueError('Operación ML desconocida')
            print(json.dumps({'id':message['id'],'data':data},allow_nan=False),flush=True)
        except Exception as e:
            print(json.dumps({'id':message.get('id'),'error':str(e)[:240]},allow_nan=False),flush=True)
if __name__=='__main__':main()
