"""Referencia SEN0237/SEN0237-A; nunca es una entrada del ML.

Vsat(T): curva de calibración a saturación de DFRobot (1 o 2 puntos).
Solubilidad: Benson–Krause del paquete original. Se normaliza Vsat al
P actual y se corrige solubilidad; evita contar dos veces la respuesta a P.
La referencia es calculada y experimental, no un OD directamente digital.
"""
import math


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_settings(s):
    if not isinstance(s, dict) or not isinstance(s.get('validationEnabled'), bool):
        raise ValueError('Indica si está habilitada la validación OD.')
    lot=s.get('lotId')
    if not isinstance(lot,str) or not lot.strip() or len(lot)>80:
        raise ValueError('Identificador de lote obligatorio (máximo 80 caracteres).')
    c=s.get('calibration')
    if c is None:
        return {**s,'lotId':lot.strip(),'calibration':None}
    if not isinstance(c,dict) or c.get('sensor') not in ['SEN0237','SEN0237-A'] or c.get('confirmed') is not True:
        raise ValueError('Confirma el sensor y la calibración efectivamente realizada.')
    if c.get('mode') not in ['one_point','two_point','zero_span']:
        raise ValueError('Selecciona uno de los tres métodos de calibración OD.')
    for key,lo,hi in [('voltage1Mv',1,3300),('temperature1C',0,40),('calibrationPressureHpa',507,1114)]:
        if not number(c.get(key)) or not lo<=c[key]<=hi:
            raise ValueError('Parámetro de calibración inválido: '+key)
    if c['mode']=='two_point':
        for key,lo,hi in [('voltage2Mv',1,3300),('temperature2C',0,40)]:
            if not number(c.get(key)) or not lo<=c[key]<=hi: raise ValueError('Segundo punto inválido.')
        if c['temperature1C']==c['temperature2C']: raise ValueError('Las temperaturas de calibración deben ser distintas.')
    if c['mode']=='zero_span':
        for key,lo,hi in [('zeroVoltageMv',0,3300),('zeroTemperatureC',0,40),('temperatureToleranceC',0,2)]:
            if not number(c.get(key)) or not lo<=c[key]<=hi:raise ValueError('Parámetro 0 % / 100 % inválido: '+key)
        if c['voltage1Mv']-c['zeroVoltageMv']<1:raise ValueError('El voltaje de 100 % debe superar al de 0 % por al menos 1 mV. Revisa los puntos y las unidades.')
        if abs(c['zeroTemperatureC']-c['temperature1C'])>c['temperatureToleranceC']:
            raise ValueError('Los puntos 0 % y 100 % deben medirse a la misma temperatura dentro de la tolerancia indicada.')
    if c.get('salinityMode') not in ['freshwater','manual','conductivity_proxy']:
        raise ValueError('Selecciona explícitamente el método de compensación salina.')
    if c['salinityMode']=='manual' and (not number(c.get('salinityPpt')) or not 0<=c['salinityPpt']<=40):
        raise ValueError('Salinidad manual requerida: 0–40 ppt.')
    return {**s,'lotId':lot.strip()}


def reference(row,settings,saturation):
    if not settings.get('validationEnabled'): return None,'Validación OD desactivada'
    c=settings.get('calibration')
    if c is None: return None,'Sin calibración: referencia no disponible'
    t,p,v=row.get('temperature'),row.get('pressure'),row.get('odVoltageV')
    if not all(number(x) for x in [t,p,v]): return None,'Falta VOD, temperatura o presión simultánea'
    if not 0<=t<=40 or not 507<=p<=1114 or not 0<=v<=3.3: return None,'Fuera del rango de referencia o voltaje ADC'
    # Un cero de voltaje no se declara desconexión sin un indicador del firmware.
    signal_mv=v*1000
    if c['mode']=='zero_span':
        if abs(t-c['temperature1C'])>c['temperatureToleranceC']:
            return None,'Fuera de la temperatura admitida para calibración 0 % / 100 %; recalibrar a la temperatura actual'
        signal_mv-=c['zeroVoltageMv']
        if signal_mv<0:return None,'Voltaje OD inferior al cero calibrado; revisar sensor/calibración'
        vsat=c['voltage1Mv']-c['zeroVoltageMv']
    elif c['mode']=='one_point': vsat=c['voltage1Mv']+35*(t-c['temperature1C'])
    else: vsat=c['voltage2Mv']+(t-c['temperature2C'])*(c['voltage1Mv']-c['voltage2Mv'])/(c['temperature1C']-c['temperature2C'])
    if vsat<=0: return None,'Curva de calibración no válida para esta temperatura'
    ec=row.get('conductivity')
    if c['salinityMode']=='conductivity_proxy':
        if not number(ec) or not 0<=ec<=59.118: return None,'Conductividad ausente/fuera del rango del proxy salino'
        sal=5.572e-4*(ec*1000)+2.02e-9*(ec*1000)**2
    else: sal=0 if c['salinityMode']=='freshwater' else c['salinityPpt']
    if sal>40:return None,'Proxy de salinidad mayor que 40 ppt'
    tk=t+273.15
    salt_factor=math.exp(-sal*(.017674-10.754/tk+2140.7/tk**2))
    fresh_now=float(saturation(t,0,p))
    fresh_cal=float(saturation(t,0,c['calibrationPressureHpa']))
    pressure_factor=fresh_now/fresh_cal
    normalized_vsat=vsat*pressure_factor
    result=(signal_mv/normalized_vsat)*fresh_now*salt_factor
    extra='; señal superior al punto 100 %, extrapolación' if c['mode']=='zero_span' and signal_mv>vsat else ''
    return result,('Referencia calculada; método '+c['mode']+'; compensación salina '+c['salinityMode']+extra+'; requiere validación experimental')


def metrics(pairs):
    if not pairs:return {'n':0,'mae':None,'rmse':None,'r2':None}
    ys=[r[1] for r in pairs];es=[r[0]-r[1] for r in pairs];n=len(es)
    avg=sum(ys)/n;den=sum((y-avg)**2 for y in ys)
    return {'n':n,'mae':sum(abs(e) for e in es)/n,'rmse':math.sqrt(sum(e*e for e in es)/n),'r2':1-sum(e*e for e in es)/den if n>=2 and den>0 else None}
