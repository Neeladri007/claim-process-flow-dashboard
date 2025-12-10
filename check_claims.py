import pandas as pd

# Load exposure data
exp = pd.read_csv('dash_dashboard/data/dummy_snowflake_data.csv', dtype={'CLAIM_NBR': str, 'CLAIM_OWNR_EMPLY_NBR': str})
exp['CLAIM_NBR'] = exp['CLAIM_NBR'].apply(lambda x: str(x) if pd.notna(x) and (str(x).startswith('0') or not str(x).isdigit()) else '0' + str(x))

# Load flow data  
flow = pd.read_csv('dash_dashboard/data/simulated_claim_activities_2.csv', dtype={'Claim_Number': str})

print('Exposure claims sample:', sorted(exp['CLAIM_NBR'].unique())[:5])
print('Flow claims sample:', sorted(flow['Claim_Number'].astype(str).unique())[:5])

print('\nChecking N0313299:')
owner_claims = exp[exp['CLAIM_OWNR_EMPLY_NBR']=='N0313299']
print(f'Claims for N0313299: {len(owner_claims)}')
if len(owner_claims) > 0:
    claim_num = owner_claims['CLAIM_NBR'].iloc[0]
    print(f'That claim number: {claim_num}')
    print(f'Is it in flow data? {claim_num in flow["Claim_Number"].values}')
    
    # Check without leading zero
    claim_no_zero = claim_num.lstrip('0')
    print(f'Without leading zero: {claim_no_zero}')
    print(f'Is that in flow data? {claim_no_zero in flow["Claim_Number"].astype(str).values}')
