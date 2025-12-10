"""
Generate dummy claim and exposure data matching the Snowflake schema.

This script creates realistic dummy data with:
- Claim-level attributes (constant across all exposures for a claim)
- Exposure-level attributes (constant within each exposure but vary across exposures)
- Multiple exposures per claim
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
import os

# Set random seed for reproducibility
np.random.seed(42)
random.seed(42)

# Configuration
MIN_EXPOSURES_PER_CLAIM = 1
MAX_EXPOSURES_PER_CLAIM = 3

# Path to existing claim activities file
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CLAIM_ACTIVITIES_FILE = os.path.join(DATA_DIR, "simulated_claim_activities.csv")

# Define data generation parameters
COVERAGE_TYPES = ['Liability Property Damage', 'Uninsured Motorist Property Damage', 'Collision', 'Collision - Vehicle Damage']
COVERAGE_SUBTYPES = ['Liability - (Auto) Property Damage', 'Uninsured Motorist Property Damage', 'Collision - Vehicle Damage']
LIABILITY_TYPES = ['Property Damage Liability']
ASSIGNMENT_STATUS = ['Assigned']
CLAIMANT_TYPES = ['Owner/Operator of other Vehicle', 'Insured']
STATUSES = ['Closed']
STRATEGIES = ['Standard', 'apd_express', 'apd_tl', 'APD : Express', 'APD : TL', 'APD - TL']
CHANNEL_TYPES = ['apd_express', 'apd_tl', 'APD : Express', 'APD : TL', 'APD - TL']
CLAIMANT_FIRST_NAMES = ['Unknown', 'Janie', None]
EXPOSURE_TYPES = ['Vehicle', 'VehicleDamage']
TIER_DESCRIPTIONS = ['3rd Party Physical Damage - Low Complexity', '1st Party Physical Damage - High Complexity', '1st Party Physical Damage']
CLSD_OUTCOME_TYPES = ['Incident Only', 'Settled']
LOSS_PARTY_TYPES = ['Third Party', 'Insured']
ASSIGNMENT_TYPES = ['owneroperator', 'assign_cc_app_user']
EXPOSURE_STATUS_TYPES = ['closed']
STRATEGY_TYPES = ['standard']
SEGMENT_TYPES = ['apd_express', 'apd_tl', 'APD : Express', 'APD : TL', 'APD - TL']
TYPE_CDS = ['VehicleDamage']
TIER_CDS = ['3p_pd_low', '1p_pd_high']
CLSD_OUTCOME_TYPE_CDS = ['incident_only', 'settled']
LOSS_PARTY_TYPE_CDS = ['third_party', 'insured']
LGCY_CLAIM_TYPES = ['LA', 'PD']
LGCY_CLAIM_TYPE_DESCS = ['Auto Liability', 'Auto Insured']
MATTER_INDS = ['N']
SEGMENT_DESCS = ['APD : Express', 'Total Loss', 'APD - TL']
ASSIGNMENT_GROUP_NAMES = ['Total Loss']
SALVAGE_INDS = ['Y', 'N']
ASSIGNMENT_GROUP_IDS = ['Y', 'apd-total-loss']
COVERAGE_TYPES_CD = ['LIPD', 'UMPD', 'COLL']
COVERAGE_SUBTYPE_CDS = ['lipd_vd', 'umpd_vd', 'coll_vd']
ASSIGNMENT_STTS_CDS = ['assigned']
CLAIMANT_TYPE_CDS = ['owneroperator', 'insured']
EXPSR_STTS_CDS = ['closed']
EXPSR_STRGY_CDS = ['standard']
CHANNEL_EXPSR_SEG_CDS = ['apd_express', 'apd_tl']
INIT_EXPSR_SEG_DESCS = ['APD : Express', 'APD : TL']
CITIES = ['San Antonio', 'Houston', 'Dallas', 'Austin', 'El Paso', 'Fort Worth']
STATES = ['TX', 'CA', 'FL', 'NY', 'IL']
STATE_NAMES = ['Texas', 'California', 'Florida', 'New York', 'Illinois']
ZIP_CODES = ['78221', '77001', '75201', '78701', '79901', '76101']
JURIS_ST_DESCS = ['cit_no_issues', 'cit_afforded', 'No Issues', 'Coverage Afforded']
JURIS_DTRMN_TYPE_CDS = ['cit_no_issues', 'cit_afforded']
JURIS_DTRMN_TYPE_DESCS = ['No Issues', 'Coverage Afforded']
CNTRL_ACCESS_INDS = ['N']
LSVL_INDS = ['N']
CLAIM_SEG_DESCS = ['Unknown', 'APD - TL']
CLAIM_TIER_DESCS = ['Medium Severity', 'Digital']
CLAIM_RPT_TYPE_DESCS = ['Digital', 'Self/Insured']
LOSS_TYPE_DESCS = ['Auto']
LOSS_CITY_NAMES = CITIES
LOSS_STATE_CDS = STATES
LOSS_STATE_DESCS = STATE_NAMES
FAULT_RTG_DESCS = ['Insured not at fault', 'Insured not at Fault']
POLICY_STATE_CDS = STATES
POLICY_STATE_DESCS = STATE_NAMES
RPTD_BY_TYPE_DESCS = ['Self/Insured']
FLAGD_DESCS = ['Never flagged', 'Never Flagged']
LOSS_CAUS_CTGRY_DESCS = ['Another Vehicle Hit Parked Insured', 'Insured Parked', 'insdparkedHit', 'multiVehicleAccidentAuto']
LOSS_CAUS_TYP_DESCS = ['Multi-Vehicle Accident', 'Multi Vehicle Accident']
LOSS_CTGRY_TYP_DESCS = ['eFNOL', 'efnol']
XTRNAL_RCSTN_SRCE_TYPS = ['eFNOL', 'efnol']
LOSS_CAUS_CTGRY_CDS = ['12', '4']
POLICY_SYMBLS = ['AB', 'T']
POLICY_COS = ['T']
REFRL_SRCE_DESCS = ['Safeco Regional']
POLICY_STTS_DESCS = ['inforce', 'In force', 'In Force']
BRAND_DESCS = ['SAF', 'Safeco']
BRAND_CDS = ['SAF']
AGNT_DIVS = ['6', '34']
PRDCT_LINE_DESCS = ['AUT', 'Automobile']
POLICY_SRCE_DESCS = ['Safeco Auto', 'AUT']


def load_existing_claim_numbers():
    """Load claim numbers from existing claim activities CSV file."""
    if not os.path.exists(CLAIM_ACTIVITIES_FILE):
        print(f"Warning: Claim activities file not found at {CLAIM_ACTIVITIES_FILE}")
        print("Generating random claim numbers instead...")
        return None
    
    try:
        df = pd.read_csv(CLAIM_ACTIVITIES_FILE, dtype={'Claim_Number': str})
        claim_numbers = df['Claim_Number'].unique().tolist()
        # Ensure all claim numbers have leading zero
        claim_numbers = [cn if cn.startswith('0') else '0' + cn for cn in claim_numbers]
        print(f"✓ Loaded {len(claim_numbers)} existing claim numbers from {os.path.basename(CLAIM_ACTIVITIES_FILE)}")
        return claim_numbers
    except Exception as e:
        print(f"Error loading claim numbers: {e}")
        print("Generating random claim numbers instead...")
        return None


def generate_claim_number():
    """Generate a claim number with leading zero (fallback if file not found)."""
    return f"0{random.randint(60000000, 69999999)}"


def generate_exposure_id(claim_nbr, seq):
    """Generate exposure ID based on claim number and sequence."""
    return f"{claim_nbr}-{seq:04d}"


def generate_incident_id():
    """Generate incident ID."""
    return f"cc:{random.randint(40000000, 49999999)}"


def generate_order_number():
    """Generate order number."""
    return f"n0{random.randint(300000, 399999)}"


def generate_contact_id():
    """Generate contact ID."""
    return f"n0{random.randint(300000, 399999)}"


def generate_user_id():
    """Generate user ID."""
    return f"user:{random.randint(10000, 19999)}"


def generate_employee_name():
    """Generate employee name."""
    return f"N0{random.randint(300000, 399999)}"


def generate_audit_id():
    """Generate audit ID."""
    return random.randint(5500000, 5600000)


def generate_hash_id():
    """Generate hash ID."""
    chars = '0123456789ABCDEF'
    return ''.join(random.choice(chars) for _ in range(32))


def generate_policy_number():
    """Generate policy number."""
    return f"Y{random.randint(9000000, 9999999)}"


def generate_agent_id():
    """Generate agent ID."""
    return random.randint(5000, 6000)


def generate_product_line_cd():
    """Generate product line code."""
    return random.randint(200, 300)


def generate_naic_rptg_policy_nbr():
    """Generate NAIC reporting policy number."""
    return f"ABT{random.randint(29000000000, 29999999999)}"


def generate_datetime(start_date, end_date):
    """Generate random datetime between two dates."""
    delta = end_date - start_date
    random_days = random.randint(0, delta.days)
    random_seconds = random.randint(0, 86400)
    return start_date + timedelta(days=random_days, seconds=random_seconds)


def generate_claim_data():
    """Generate complete claim and exposure data."""
    
    # Load existing claim numbers
    existing_claim_numbers = load_existing_claim_numbers()
    
    if existing_claim_numbers is None:
        # Fallback: generate 50 random claim numbers
        existing_claim_numbers = [generate_claim_number() for _ in range(50)]
        print(f"Generated {len(existing_claim_numbers)} random claim numbers")
    
    all_data = []
    
    # Date ranges
    min_date = datetime(2024, 12, 1)
    max_date = datetime(2024, 12, 18)
    
    for claim_nbr in existing_claim_numbers:
        # Generate claim-level attributes (constant for all exposures of this claim)
        # claim_nbr already assigned from existing data
        claim_sid = random.randint(135000000, 139999999)
        
        # Claim dates
        claim_rptd_dt = generate_datetime(min_date, max_date)
        claim_open_dt = claim_rptd_dt + timedelta(hours=random.randint(0, 48))
        claim_clsd_dt = claim_open_dt + timedelta(days=random.randint(1, 30))
        claim_reopnd_dt = claim_clsd_dt if random.random() > 0.8 else None
        
        # Claim attributes
        claim_stts_desc = random.choice(STATUSES)
        claim_clsd_outcm_cd = random.choice(['closed', 'automatic'])
        claim_clsd_outcm_type_cd = random.choice(CLSD_OUTCOME_TYPE_CDS)
        claim_clsd_outcm_type_desc = random.choice(CLSD_OUTCOME_TYPES)
        claim_reopnd_rsn_desc = random.choice(['Automated Closing', 'unknown']) if claim_reopnd_dt else None
        claim_strgy_desc = random.choice(['Unknown'])
        claim_seg_desc = random.choice(CLAIM_SEG_DESCS)
        claim_tier_desc = random.choice(CLAIM_TIER_DESCS)
        claim_rpt_type_desc = random.choice(CLAIM_RPT_TYPE_DESCS)
        
        # Claim owner info
        claim_ownr_cntct_id = generate_contact_id()
        claim_ownr_sys_user_id = generate_contact_id()
        claim_ownr_emply_nbr = generate_employee_name()
        
        # Claim reporter info
        rpt_takr_cntct_id = generate_contact_id()
        rpt_takr_sys_user_id = generate_user_id()
        rpt_takr_emply_nbr = generate_employee_name() if random.random() > 0.5 else None
        
        # Assignment info
        assgd_by_cntct_id = random.choice(['assign_cc_app_user'])
        assgd_by_sys_user_id = random.choice(['assign_cc_app_user'])
        assgd_by_emply_nbr = None
        
        # Loss information
        loss_dt = claim_rptd_dt - timedelta(days=random.randint(0, 5))
        loss_type_desc = random.choice(LOSS_TYPE_DESCS)
        loss_city_nme = random.choice(LOSS_CITY_NAMES)
        loss_st_cd = random.choice(LOSS_STATE_CDS)
        loss_st_desc = random.choice(LOSS_STATE_DESCS)
        loss_zip_cd = random.choice(ZIP_CODES)
        loss_cnty_nme = None
        cat_ind = 'N'
        cat_cd = None
        fault_rate = random.choice([0, 4])
        fault_rtg_desc = random.choice(FAULT_RTG_DESCS)
        loss_caus_ctgry_desc = random.choice(LOSS_CAUS_CTGRY_DESCS)
        loss_caus_typ_desc = random.choice(LOSS_CAUS_TYP_DESCS)
        loss_ctgry_typ_desc = random.choice(LOSS_CTGRY_TYP_DESCS)
        xtrnal_rcstn_srce_typ = random.choice(XTRNAL_RCSTN_SRCE_TYPS)
        xtrnal_rcstn_srce_desc = random.choice(XTRNAL_RCSTN_SRCE_TYPS)
        loss_caus_ctgry_cd = random.choice(LOSS_CAUS_CTGRY_CDS)
        
        # Policy information
        policy_nbr = generate_policy_number()
        policy_st_cd = random.choice(POLICY_STATE_CDS)
        policy_st_desc = random.choice(POLICY_STATE_DESCS)
        rptd_by_type_desc = random.choice(RPTD_BY_TYPE_DESCS)
        flagd_desc = random.choice(FLAGD_DESCS)
        flagd_cd = random.choice(['neverflagged'])
        flagd_dt = None
        
        # Policy dates
        policy_efctv_dt = loss_dt - timedelta(days=random.randint(30, 365))
        policy_xprtn_dt = policy_efctv_dt + timedelta(days=365)
        policy_first_yr = policy_efctv_dt.year
        policy_stts_cd = random.choice(['inforce'])
        policy_stts_desc = random.choice(POLICY_STTS_DESCS)
        
        # Policy details
        new_policy_ind = 'N'
        policy_total_vehicles = random.randint(1, 3)
        policy_total_properties = random.randint(0, 2)
        lsvl_ind = random.choice(LSVL_INDS)
        rptg_enty_cd = random.randint(1700, 1800)
        rptg_enty_desc = 'Liberty County Mutual Insurance Company'
        brand_cd = random.choice(BRAND_CDS)
        brand_desc = random.choice(BRAND_DESCS)
        agnt_div = random.choice(AGNT_DIVS)
        agnt_zone = random.choice(['84', '34'])
        agnt_stat = random.choice(['5203', '5208'])
        agnt_id = generate_agent_id()
        prdct_line_cd = 'AUT'
        prdct_line_desc = random.choice(PRDCT_LINE_DESCS)
        policy_srce_cd = 'AUT'
        policy_srce_desc = random.choice(POLICY_SRCE_DESCS)
        naic_rptg_policy_nbr = generate_naic_rptg_policy_nbr()
        
        # Additional policy attributes
        policy_symbl_cd = random.choice(POLICY_SYMBLS)
        policy_co_cd = random.choice(POLICY_COS)
        policy_mrkt_cd = random.randint(1, 3)
        invol_mrkt_ind = 'N'
        refrl_srce_cd = random.randint(24, 30)
        refrl_srce_desc = random.choice(REFRL_SRCE_DESCS)
        cntrl_access_ind = random.choice(CNTRL_ACCESS_INDS)
        emply_claim_ind = 'N'
        
        # Data management fields
        dm_begn_dt = claim_open_dt
        dm_end_dt = datetime(9999, 12, 31)
        dm_crrnt_row_ind = 'Y'
        dm_row_prcs_dt = claim_open_dt + timedelta(days=1)
        dm_row_prcs_updt_dt = claim_clsd_dt + timedelta(days=1) if claim_clsd_dt else dm_row_prcs_dt
        cnvrtd_claim_ind = 'N'
        dm_insrt_audit_id = generate_audit_id()
        dm_updt_audit_id = generate_audit_id()
        
        # Claim status codes
        claim_stts_cd = 'closed'
        claim_clsd_outm_cd = random.choice(['closed', 'automatic'])
        claim_reopnd_rsn_cd = random.choice(['unknown', 'apd_tl']) if claim_reopnd_dt else None
        claim_strgy_cd = random.choice(['unknown', 'apd_tl'])
        claim_seg_cd = random.choice(['apd_tl', 'digital'])
        claim_tier_cd = random.choice(['medium', 'digital'])
        claim_rpt_type_cd = random.choice(['digital', 'self'])
        loss_type_cd = 'AUTO'
        fault_rtg_cd = random.choice(['self', '4'])
        
        # Generate exposures for this claim
        num_exposures = random.randint(MIN_EXPOSURES_PER_CLAIM, MAX_EXPOSURES_PER_CLAIM)
        
        for exp_seq in range(1, num_exposures + 1):
            # Exposure-level attributes (constant within exposure)
            expsr_id = generate_exposure_id(claim_nbr, exp_seq)
            incdt_id = generate_incident_id()
            lm_vision_sufx_nbr = exp_seq
            expsr_nbr = f"{claim_nbr}-{exp_seq:04d}"
            vision_id_nbr = f"{claim_nbr}-{exp_seq:04d}"
            
            # Exposure dates
            expsr_open_dtm = claim_open_dt + timedelta(hours=random.randint(0, 24))
            expsr_clsd_dtm = claim_clsd_dt + timedelta(hours=random.randint(-24, 24)) if claim_clsd_dt else None
            expsr_reopnd_dt = claim_reopnd_dt if claim_reopnd_dt and random.random() > 0.5 else None
            
            # Coverage information
            cvrc_type_desc = random.choice(COVERAGE_TYPES)
            cvrc_sbtyp_desc = random.choice(COVERAGE_SUBTYPES)
            ldb_dtl_cd = random.choice(['PD'])
            ldb_dtl_desc = random.choice(LIABILITY_TYPES)
            expsr_asgmt_stts_desc = random.choice(ASSIGNMENT_STATUS)
            clmnt_type_desc = random.choice(CLAIMANT_TYPES)
            expsr_stts_desc = random.choice(STATUSES)
            expsr_strgy_desc = random.choice(STRATEGIES)
            expsr_tier_desc = random.choice(TIER_DESCRIPTIONS)
            expsr_clsd_outcm_type_desc = random.choice(CLSD_OUTCOME_TYPES)
            expsr_reopnd_rsn_desc = None
            loss_party_type_desc = random.choice(LOSS_PARTY_TYPES)
            lost_prop_type_desc = None
            
            # Exposure IDs and codes
            subro_ind = 'N'
            mcca_ind = 'N'
            ucif_ind = 'N'
            ime_pfrmd_ind = 'N'
            siu_ind = 'N'
            cvrc_type_cd = random.choice(COVERAGE_TYPES_CD)
            cvrc_sbtyp_cd = random.choice(COVERAGE_SUBTYPE_CDS)
            expsr_asgnt_stts_cd = random.choice(ASSIGNMENT_STTS_CDS)
            clmnt_type_cd = random.choice(CLAIMANT_TYPE_CDS)
            expsr_stts_cd = random.choice(EXPSR_STTS_CDS)
            expsr_strgy_cd = random.choice(EXPSR_STRGY_CDS)
            channel_expsr_seg_cd = random.choice(CHANNEL_EXPSR_SEG_CDS)
            expsr_type_cd = random.choice(TYPE_CDS)
            expsr_tier_cd = random.choice(TIER_CDS)
            expsr_clsd_outcm_type_cd = random.choice(CLSD_OUTCOME_TYPE_CDS)
            loss_party_type_cd = random.choice(LOSS_PARTY_TYPE_CDS)
            
            # Exposure owner info
            expsr_ownr_cntct_id = generate_contact_id()
            expsr_ownr_sys_user_id = generate_contact_id()
            expsr_ownr_emply_nbr = generate_employee_name()
            
            # Claimant info
            expsr_clmnt_first_nme = random.choice(CLAIMANT_FIRST_NAMES)
            
            # Jury and audit info
            dm_insrt_audit_id_exp = generate_audit_id()
            dm_updt_audit_id_exp = generate_audit_id()
            
            # Exposure assignment info
            expsr_assgd_by_ownr_cntct_id = random.choice(['assign_cc_app_user'])
            expsr_assgd_by_ownr_sys_usr_id = random.choice(['assign_cc_app_user'])
            expsr_assgd_by_ownr_emply_nbr = None
            
            # Incident and assignment dates
            expsr_init_assgd_dt = expsr_open_dtm + timedelta(hours=random.randint(1, 12))
            
            # Jurisdiction info
            juris_st_cd = random.choice(STATES)
            juris_st_desc = random.choice(STATE_NAMES)
            cvrc_iss_type_cd = random.choice(JURIS_DTRMN_TYPE_CDS)
            cvrc_iss_type_desc = random.choice(JURIS_DTRMN_TYPE_DESCS)
            cvrc_dtrmn_type_cd = random.choice(JURIS_DTRMN_TYPE_CDS)
            cvrc_dtrmn_type_desc = random.choice(JURIS_DTRMN_TYPE_DESCS)
            orgng_iss_ind = 'N'
            insd_own_nonlstd_vehcl_ind = 'N'
            vehcl_listed_on_policy_ind = random.choice(['Y', 'N'])
            acdt_lmt_amt = random.choice([25000, None])
            lblty_dtrmn_type_cd = random.choice(['lblty_denial', None])
            lblty_dtrmn_type_desc = random.choice(['Liability Denial', None])
            cmprty_nglgnc_ind = 'N'
            
            # Financial info
            expsr_order_nbr = generate_order_number()
            fincl_mgmt_line_cd = random.randint(200, 300)
            fincl_mgmt_line_desc = 'PRIVATE PASSENGER AUTO LIABILITY-PROPERTY DAMAGE'
            crrnt_ncvra_ind = 'N'
            
            # Coverage financial details
            cvrg_efctv_dt = policy_efctv_dt + timedelta(days=random.randint(0, 30))
            cvrg_xprtn_dt = policy_xprtn_dt
            cvrg_debel = cvrg_xprtn_dt + timedelta(days=1)
            
            # Segment and channel info
            init_expsr_seg_desc = random.choice(INIT_EXPSR_SEG_DESCS)
            assgd_grp_nme = random.choice(ASSIGNMENT_GROUP_NAMES) if random.random() > 0.7 else None
            salvage_ind = random.choice(SALVAGE_INDS)
            assgd_grp_id = random.choice(ASSIGNMENT_GROUP_IDS) if assgd_grp_nme else None
            cvrc_stts_desc = random.choice(['VERIFIED'])
            aces_claim_nbr = None
            aces_claim_id = random.choice([f"AL980-HA7446-{random.randint(1, 99):02d}", None])
            
            # Liability info
            lglty_typ_cd = random.choice(['LA', 'PD'])
            lglty_claim_typ_desc = random.choice(LGCY_CLAIM_TYPE_DESCS)
            matter_ind = random.choice(MATTER_INDS)
            ltgn_ind = random.choice(MATTER_INDS)
            
            # Compile exposure record
            record = {
                # Claim-level fields (constant across exposures)
                'CLAIM_NBR': claim_nbr,
                'CLAIM_SID': claim_sid,
                'CLAIM_RPTD_DT': claim_rptd_dt.strftime('%m/%d/%Y'),
                'CLAIM_OPEN_DT': claim_open_dt.strftime('%m/%d/%Y'),
                'CLAIM_CLSD_DT': claim_clsd_dt.strftime('%m/%d/%Y') if claim_clsd_dt else None,
                'CLAIM_REOPND_DT': claim_reopnd_dt.strftime('%m/%d/%Y') if claim_reopnd_dt else None,
                'CLAIM_STTS_DESC': claim_stts_desc,
                'CLAIM_CLSD_OUTCM_CD': claim_clsd_outcm_cd,
                'CLAIM_CLSD_OUTCM_TYPE_CD': claim_clsd_outcm_type_cd,
                'CLAIM_CLSD_OUTCM_TYPE_DESC': claim_clsd_outcm_type_desc,
                'CLAIM_REOPND_RSN_DESC': claim_reopnd_rsn_desc,
                'CLAIM_STRGY_DESC': claim_strgy_desc,
                'CLAIM_SEG_DESC': claim_seg_desc,
                'CLAIM_TIER_DESC': claim_tier_desc,
                'CLAIM_RPT_TYPE_DESC': claim_rpt_type_desc,
                'CLAIM_OWNR_CNTCT_ID': claim_ownr_cntct_id,
                'CLAIM_OWNR_SYS_USER_ID': claim_ownr_sys_user_id,
                'CLAIM_OWNR_EMPLY_NBR': claim_ownr_emply_nbr,
                'RPT_TAKR_CNTCT_ID': rpt_takr_cntct_id,
                'RPT_TAKR_SYS_USER_ID': rpt_takr_sys_user_id,
                'RPT_TAKR_EMPLY_NBR': rpt_takr_emply_nbr,
                'ASSGD_BY_CNTCT_ID': assgd_by_cntct_id,
                'ASSGD_BY_SYS_USER_ID': assgd_by_sys_user_id,
                'ASSGD_BY_EMPLY_NBR': assgd_by_emply_nbr,
                'LOSS_DT': loss_dt.strftime('%m/%d/%Y'),
                'LOSS_TYPE_DESC': loss_type_desc,
                'LOSS_CITY_NME': loss_city_nme,
                'LOSS_ST_CD': loss_st_cd,
                'LOSS_ST_DESC': loss_st_desc,
                'LOSS_ZIP_CD': loss_zip_cd,
                'LOSS_CNTY_NME': loss_cnty_nme,
                'CAT_IND': cat_ind,
                'CAT_CD': cat_cd,
                'FAULT_RATE': fault_rate,
                'FAULT_RTG_DESC': fault_rtg_desc,
                'LOSS_CAUS_CTGRY_DESC': loss_caus_ctgry_desc,
                'LOSS_CAUS_TYP_DESC': loss_caus_typ_desc,
                'LOSS_CTGRY_TYP_DESC': loss_ctgry_typ_desc,
                'XTRNAL_RCSTN_SRCE_TYP': xtrnal_rcstn_srce_typ,
                'XTRNAL_RCSTN_SRCE_DESC': xtrnal_rcstn_srce_desc,
                'LOSS_CAUS_CTGRY_CD': loss_caus_ctgry_cd,
                'POLICY_NBR': policy_nbr,
                'POLICY_ST_CD': policy_st_cd,
                'POLICY_ST_DESC': policy_st_desc,
                'RPTD_BY_TYPE_DESC': rptd_by_type_desc,
                'FLAGD_DESC': flagd_desc,
                'FLAGD_CD': flagd_cd,
                'FLAGD_DT': flagd_dt,
                'POLICY_EFCTV_DT': policy_efctv_dt.strftime('%m/%d/%Y'),
                'POLICY_XPRTN_DT': policy_xprtn_dt.strftime('%m/%d/%Y'),
                'POLICY_FIRST_YR': policy_first_yr,
                'POLICY_STTS_CD': policy_stts_cd,
                'POLICY_STTS_DESC': policy_stts_desc,
                'NEW_POLICY_IND': new_policy_ind,
                'POLICY_TOTAL_VEHICLES': policy_total_vehicles,
                'POLICY_TOTAL_PROPERTIES': policy_total_properties,
                'LSVL_IND': lsvl_ind,
                'RPTG_ENTY_CD': rptg_enty_cd,
                'RPTG_ENTY_DESC': rptg_enty_desc,
                'BRAND_CD': brand_cd,
                'BRAND_DESC': brand_desc,
                'AGNT_DIV': agnt_div,
                'AGNT_ZONE': agnt_zone,
                'AGNT_STAT': agnt_stat,
                'AGNT_ID': agnt_id,
                'PRDCT_LINE_CD': prdct_line_cd,
                'PRDCT_LINE_DESC': prdct_line_desc,
                'POLICY_SRCE_CD': policy_srce_cd,
                'POLICY_SRCE_DESC': policy_srce_desc,
                'NAIC_RPTG_POLICY_NBR': naic_rptg_policy_nbr,
                'POLICY_SYMBL_CD': policy_symbl_cd,
                'POLICY_CO_CD': policy_co_cd,
                'POLICY_MRKT_CD': policy_mrkt_cd,
                'INVOL_MRKT_IND': invol_mrkt_ind,
                'REFRL_SRCE_CD': refrl_srce_cd,
                'REFRL_SRCE_DESC': refrl_srce_desc,
                'CNTRL_ACCESS_IND': cntrl_access_ind,
                'EMPLY_CLAIM_IND': emply_claim_ind,
                'DM_BEGN_DT': dm_begn_dt.strftime('%m/%d/%Y'),
                'DM_END_DT': '12/31/9999',
                'DM_CRRNT_ROW_IND': dm_crrnt_row_ind,
                'DM_ROW_PRCS_DT': dm_row_prcs_dt.strftime('%m/%d/%Y'),
                'DM_ROW_PRCS_UPDT_DT': dm_row_prcs_updt_dt.strftime('%m/%d/%Y'),
                'CNVRTD_CLAIM_IND': cnvrtd_claim_ind,
                'DM_INSRT_AUDIT_ID': dm_insrt_audit_id,
                'DM_UPDT_AUDIT_ID': dm_updt_audit_id,
                'CLAIM_STTS_CD': claim_stts_cd,
                'CLAIM_CLSD_OUTM_CD': claim_clsd_outm_cd,
                'CLAIM_REOPND_RSN_CD': claim_reopnd_rsn_cd,
                'CLAIM_STRGY_CD': claim_strgy_cd,
                'CLAIM_SEG_CD': claim_seg_cd,
                'CLAIM_TIER_CD': claim_tier_cd,
                'CLAIM_RPT_TYPE_CD': claim_rpt_type_cd,
                'LOSS_TYPE_CD': loss_type_cd,
                'FAULT_RTG_CD': fault_rtg_cd,
                
                # Exposure-level fields (constant within exposure)
                'EXPSR_ID': expsr_id,
                'INCDT_ID': incdt_id,
                'LM_VISION_SUFX_NBR': lm_vision_sufx_nbr,
                'EXPSR_NBR': expsr_nbr,
                'VISION_ID_NBR': vision_id_nbr,
                'EXPSR_OPEN_DTM': expsr_open_dtm.strftime('%m/%d/%Y'),
                'EXPSR_CLSD_DTM': expsr_clsd_dtm.strftime('%m/%d/%Y') if expsr_clsd_dtm else None,
                'EXPSR_REOPND_DT': expsr_reopnd_dt.strftime('%m/%d/%Y') if expsr_reopnd_dt else None,
                'SUBRO_IND': subro_ind,
                'MCCA_IND': mcca_ind,
                'UCIF_IND': ucif_ind,
                'IME_PFRMD_IND': ime_pfrmd_ind,
                'SIU_IND': siu_ind,
                'CVRC_TYPE_DESC': cvrc_type_desc,
                'CVRC_SBTYP_DESC': cvrc_sbtyp_desc,
                'LDB_DTL_CD': ldb_dtl_cd,
                'LDB_DTL_DESC': ldb_dtl_desc,
                'EXPSR_ASGMT_STTS_DESC': expsr_asgmt_stts_desc,
                'CLMNT_TYPE_DESC': clmnt_type_desc,
                'EXPSR_STTS_DESC': expsr_stts_desc,
                'EXPSR_STRGY_DESC': expsr_strgy_desc,
                'CHANNEL_EXPSR_SEG_CD': channel_expsr_seg_cd,
                'EXPSR_TYPE_CD': expsr_type_cd,
                'EXPSR_TIER_DESC': expsr_tier_desc,
                'EXPSR_CLSD_OUTCM_TYPE_DESC': expsr_clsd_outcm_type_desc,
                'EXPSR_REOPND_RSN_DESC': expsr_reopnd_rsn_desc,
                'LOSS_PARTY_TYPE_DESC': loss_party_type_desc,
                'LOST_PROP_TYPE_DESC': lost_prop_type_desc,
                'CVRC_TYPE_CD': cvrc_type_cd,
                'CVRC_SBTYP_CD': cvrc_sbtyp_cd,
                'EXPSR_ASGNT_STTS_CD': expsr_asgnt_stts_cd,
                'CLMNT_TYPE_CD': clmnt_type_cd,
                'EXPSR_STTS_CD': expsr_stts_cd,
                'EXPSR_STRGY_CD': expsr_strgy_cd,
                'EXPSR_TIER_CD': expsr_tier_cd,
                'EXPSR_CLSD_OUTCM_TYPE_CD': expsr_clsd_outcm_type_cd,
                'LOSS_PARTY_TYPE_CD': loss_party_type_cd,
                'EXPSR_OWNR_CNTCT_ID': expsr_ownr_cntct_id,
                'EXPSR_OWNR_SYS_USER_ID': expsr_ownr_sys_user_id,
                'EXPSR_OWNR_EMPLY_NBR': expsr_ownr_emply_nbr,
                'EXPSR_CLMNT_FIRST_NME': expsr_clmnt_first_nme,
                'DM_INSRT_AUDIT_ID_EXP': dm_insrt_audit_id_exp,
                'DM_UPDT_AUDIT_ID_EXP': dm_updt_audit_id_exp,
                'EXPSR_ASSGD_BY_OWNR_CNTCT_ID': expsr_assgd_by_ownr_cntct_id,
                'EXPSR_ASSGD_BY_OWNR_SYS_USR_ID': expsr_assgd_by_ownr_sys_usr_id,
                'EXPSR_ASSGD_BY_OWNR_EMPLY_NBR': expsr_assgd_by_ownr_emply_nbr,
                'EXPSR_INIT_ASSGD_DT': expsr_init_assgd_dt.strftime('%m/%d/%Y'),
                'JURIS_ST_CD': juris_st_cd,
                'JURIS_ST_DESC': juris_st_desc,
                'CVRC_ISS_TYPE_CD': cvrc_iss_type_cd,
                'CVRC_ISS_TYPE_DESC': cvrc_iss_type_desc,
                'CVRC_DTRMN_TYPE_CD': cvrc_dtrmn_type_cd,
                'CVRC_DTRMN_TYPE_DESC': cvrc_dtrmn_type_desc,
                'ORGNG_ISS_IND': orgng_iss_ind,
                'INSD_OWN_NONLSTD_VEHCL_IND': insd_own_nonlstd_vehcl_ind,
                'VEHCL_LISTED_ON_POLICY_IND': vehcl_listed_on_policy_ind,
                'ACDT_LMT_AMT': acdt_lmt_amt,
                'LBLTY_DTRMN_TYPE_CD': lblty_dtrmn_type_cd,
                'LBLTY_DTRMN_TYPE_DESC': lblty_dtrmn_type_desc,
                'CMPRTY_NGLGNC_IND': cmprty_nglgnc_ind,
                'EXPSR_ORDER_NBR': expsr_order_nbr,
                'FINCL_MGMT_LINE_CD': fincl_mgmt_line_cd,
                'FINCL_MGMT_LINE_DESC': fincl_mgmt_line_desc,
                'CRRNT_NCVRA_IND': crrnt_ncvra_ind,
                'CVRG_EFCTV_DT': cvrg_efctv_dt.strftime('%m/%d/%Y'),
                'CVRG_XPRTN_DT': cvrg_xprtn_dt.strftime('%m/%d/%Y'),
                'CVRG_DEBEL': cvrg_debel.strftime('%m/%d/%Y'),
                'INIT_EXPSR_SEG_DESC': init_expsr_seg_desc,
                'ASSGD_GRP_NME': assgd_grp_nme,
                'SALVAGE_IND': salvage_ind,
                'ASSGD_GRP_ID': assgd_grp_id,
                'CVRC_STTS_DESC': cvrc_stts_desc,
                'ACES_CLAIM_NBR': aces_claim_nbr,
                'ACES_CLAIM_ID': aces_claim_id,
                'LGLTY_TYP_CD': lglty_typ_cd,
                'LGLTY_CLAIM_TYP_DESC': lglty_claim_typ_desc,
                'MATTER_IND': matter_ind,
                'LTGN_IND': ltgn_ind,
            }
            
            all_data.append(record)
    
    # Create DataFrame
    df = pd.DataFrame(all_data)
    
    return df


def main():
    """Main function to generate and save dummy data."""
    print("="*60)
    print("Generating dummy claim and exposure data...")
    print(f"Exposures per claim: {MIN_EXPOSURES_PER_CLAIM} to {MAX_EXPOSURES_PER_CLAIM}")
    print("="*60)
    
    df = generate_claim_data()
    
    print(f"\n{'='*60}")
    print(f"Generated {len(df)} exposure records")
    print(f"Unique claims: {df['CLAIM_NBR'].nunique()}")
    print(f"Average exposures per claim: {len(df) / df['CLAIM_NBR'].nunique():.2f}")
    
    # Save to CSV in data directory
    output_file = os.path.join(DATA_DIR, 'dummy_snowflake_data.csv')
    df.to_csv(output_file, index=False)
    print(f"✓ Data saved to: {output_file}")
    print("="*60)
    
    # Display sample
    print("\nSample data (first 5 rows, selected columns):")
    sample_cols = ['CLAIM_NBR', 'EXPSR_ID', 'EXPSR_NBR', 'CVRC_TYPE_DESC', 'EXPSR_STTS_DESC', 
                   'EXPSR_OPEN_DTM', 'EXPSR_CLSD_DTM']
    print(df[sample_cols].head())
    
    print("\n" + "="*60)
    print("✓ Dummy data generation complete!")
    print(f"✓ Claim numbers match: {os.path.basename(CLAIM_ACTIVITIES_FILE)}")
    print("="*60)


if __name__ == "__main__":
    main()
