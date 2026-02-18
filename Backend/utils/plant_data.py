from openoa.schema import SCADAMetaData
from openoa.schema import MeterMetaData
from openoa.schema import TowerMetaData
from openoa.schema import CurtailMetaData
from openoa.schema import StatusMetaData
from openoa.schema import AssetMetaData
from openoa.schema import ReanalysisMetaData
from openoa.schema import PlantMetaData
from openoa.plant import PlantData
def scada_metadata():
    return SCADAMetaData(
        time='time',
        asset_id='asset_id',
        WTUR_W='WTUR_W',
        WMET_HorWdSpd='WMET_HorWdSpd',
        WMET_HorWdDir='WMET_HorWdDir',
        WMET_HorWdDirRel='WMET_HorWdDirRel',
        WTUR_TurSt='WTUR_TurSt',
        WROT_BlPthAngVal='WROT_BlPthAngVal',
        WMET_EnvTmp='WMET_EnvTmp',
        frequency='10min'
    )


def meter_metadata():
    return MeterMetaData(
        time='time',
        MMTR_SupWh='MMTR_SupWh',
        frequency='10min'
    )


def tower_metadata():
    return TowerMetaData(
        time='time',
        asset_id='asset_id',
        WMET_HorWdSpd='WMET_HorWdSpd',
        WMET_HorWdDir='WMET_HorWdDir',
        WMET_EnvTmp='WMET_EnvTmp',
        frequency='10min'
    )


def curtail_metadata():
    return CurtailMetaData(
        time='time',
        IAVL_ExtPwrDnWh='IAVL_ExtPwrDnWh',
        IAVL_DnWh='IAVL_DnWh',
        frequency='10min'
    )


def status_metadata():
    return StatusMetaData(
        time='time',
        asset_id='asset_id',
        status_id='status_id',
        status_code='status_code',
        status_text='status_text',
        frequency='10min'
    )


def asset_metadata():
    return AssetMetaData(
        asset_id='asset_id',
        latitude='latitude',
        longitude='longitude',
        rated_power='rated_power',
        hub_height='hub_height',
        rotor_diameter='rotor_diameter',
        elevation='elevation',
        type='type'
    )


def reanalysis_metadata():
    return ReanalysisMetaData(
        time='time',
        WMETR_HorWdSpd='WMETR_HorWdSpd',
        WMETR_HorWdSpdU='WMETR_HorWdSpdU',
        WMETR_HorWdSpdV='WMETR_HorWdSpdV',
        WMETR_HorWdDir='WMETR_HorWdDir',
        WMETR_EnvTmp='WMETR_EnvTmp',
        WMETR_AirDen='WMETR_AirDen',
        WMETR_EnvPres='surface_pressure',
        frequency='10min'
    )


def get_plant_metadata(latitude, longitude, name, time_zone):
    return PlantMetaData(
        latitude=latitude,
        longitude=longitude,
        name=name,
        utm_zone=time_zone,
        scada=scada_metadata(),
        meter=meter_metadata(),
        tower=tower_metadata(),
        curtail=curtail_metadata(),
        status=status_metadata(),
        asset=asset_metadata(),
        reanalysis=reanalysis_metadata()
    )

def plant_data(latitude, longitude, name, time_zone,analysis_type,scada,meter,tower,curtail,status,asset,reanalysis):
    plant= PlantData(metadata=get_plant_metadata(latitude, longitude, name, time_zone),analysis_type=analysis_type,scada=scada,meter=meter,tower=tower,curtail=curtail,status=status,asset=asset,reanalysis=reanalysis)

    try:
        validate=plant.validate(get_plant_metadata(latitude, longitude, name, time_zone))
    except Exception as ValueError:
        print("Validation failed: ", ValueError)
        return ValueError

    plant.update_column_names(to_original=True)

    return plant




