import pandas as pd

df = pd.read_csv('simulated_claim_activities.csv')
sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].apply(list).to_dict()

# Check Total Loss
tl_claims = [seq for claim, seq in sequences.items() if seq[0] == 'Total Loss']
print(f'Total Loss starting claims: {len(tl_claims)}')

# Check next steps
next_steps = {}
for seq in tl_claims:
    if len(seq) > 1:
        next_proc = seq[1]
        next_steps[next_proc] = next_steps.get(next_proc, 0) + 1

print('\nNext steps from Total Loss:')
for proc, count in sorted(next_steps.items(), key=lambda x: x[1], reverse=True):
    print(f'  {proc}: {count}')

print(f'\nTotal transitions: {sum(next_steps.values())}')
print(f'Should equal starting claims: {len(tl_claims)}')
