"""Benson-Krause (1980/1984), USGS WQ.2011.03 equations (4),(7)-(11).
Outputs theoretical AIR-EQUILIBRIUM oxygen solubility (mg/L) only,
NOT actual dissolved oxygen. Salinity inferred from specific conductance
assumes seawater-like ionic composition; NOT verified for Tumbes.
Valid for ~0-40 C, 0-40 g/kg, P 0.5-1.1 atm. Bounds checked.
"""
import numpy as np

def saturacion_benson_krause(t_c, conductividad_mS_cm, presion_hPa):
 t=np.asarray(t_c,dtype=float)
 sc=np.asarray(conductividad_mS_cm,dtype=float)
 p=np.asarray(presion_hPa,dtype=float)
 tk=t+273.15
 if np.any(~np.isfinite(t+sc+p)):raise ValueError('Valores invalidos')
 if np.any((t<0)|(t>40)|(sc<0)|(sc>59.118)|(p<507)|(p>1114)):
  raise ValueError('Fuera de los rangos nominales del modelo de saturacion')
 sc_uS=sc*1000.0
 sal=5.572e-4*sc_uS+2.02e-9*sc_uS**2
 if np.any(sal>40):raise ValueError('Salinidad estimada > 40 g/kg')
 do0=np.exp(-139.34411+1.575701e5/tk-6.642308e7/tk**2+1.243800e10/tk**3-8.621949e11/tk**4)
 fs=np.exp(-sal*(.017674-10.754/tk+2140.7/tk**2))
 pressure_atm=p/1013.25
 theta=.000975-1.426e-5*t+6.436e-8*t*t
 vap_atm=np.exp(11.8571-3840.70/tk-216961/tk**2)
 fp=((pressure_atm-vap_atm)*(1-theta*pressure_atm))/((1-vap_atm)*(1-theta))
 return do0*fs*fp
