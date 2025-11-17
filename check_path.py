import pandas as pd

df = pd.read_csv('simulated_claim_activities.csv')
sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].apply(list).to_dict()

# Check a specific path: Total Loss -> Claim Admin
print("Checking: Total Loss -> Claim Admin")
tl_claims = [seq for claim, seq in sequences.items() if seq[0] == 'Total Loss']
print(f'Total Loss starting claims: {len(tl_claims)}')

# Claims that went Total Loss -> Claim Admin
tl_to_ca = [seq for seq in tl_claims if len(seq) > 1 and seq[1] == 'Claim Admin']
print(f'Claims that went Total Loss -> Claim Admin: {len(tl_to_ca)}')

# Now from those Claim Admin nodes, what are the next steps?
next_from_ca = {}
terminated_at_ca = 0
for seq in tl_to_ca:
    if len(seq) > 2:
        next_proc = seq[2]
        next_from_ca[next_proc] = next_from_ca.get(next_proc, 0) + 1
    else:
        terminated_at_ca += 1

print(f'\nNext steps from Claim Admin (after Total Loss):')
for proc, count in sorted(next_from_ca.items(), key=lambda x: x[1], reverse=True):
    print(f'  {proc}: {count}')
print(f'  Terminated: {terminated_at_ca}')

total = sum(next_from_ca.values()) + terminated_at_ca
print(f'\nTotal flows from CA: {total}')
print(f'Should equal TL->CA claims: {len(tl_to_ca)}')
print(f'Match: {total == len(tl_to_ca)}')
