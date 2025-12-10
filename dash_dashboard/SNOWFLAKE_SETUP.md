# Snowflake Data Sync - Setup Instructions

## Overview
This module automatically syncs claim data from Snowflake to local CSV files. On first run, it fetches all claims. On subsequent runs, it only fetches new claims not yet in the local database.

## Setup Steps

### 1. Install Required Package
```bash
pip install snowflake-connector-python
```

### 2. Configure Credentials
Edit `configurations/config.py` and fill in your Snowflake credentials:

```python
credentials = {
    'username': 'your_username',
    'password': 'your_password',
    'account': 'liberty_mutual_srm_us.us-east-1.privatelink',
    'warehouse': 'WH_ADHOC_M',
    'database': 'PROD_STANDARD',
    'schema': 'TELEPHONY_VIEW_S'
}
```

### 3. Adjust Data Mapping
In `snowflake_sync.py`, update the `transform_snowflake_data_to_claims_format()` function to map your Snowflake columns to the required format:

```python
def transform_snowflake_data_to_claims_format(df):
    transformed_df = pd.DataFrame({
        'Claim_Number': df['YOUR_CLAIM_NUMBER_COLUMN'],
        'Process': df['YOUR_PROCESS_COLUMN'],
        'Activity': df['YOUR_ACTIVITY_COLUMN'],
        'First_TimeStamp': pd.to_datetime(df['YOUR_TIMESTAMP_COLUMN']),
        'Active_Minutes': df['YOUR_DURATION_COLUMN']
    })
    return transformed_df
```

### 4. Adjust SQL Query (Optional)
If needed, modify the SQL query in `fetch_claims_from_snowflake()` to match your exact table structure and filtering requirements.

## How It Works

### First Run (Initial Load)
- Connects to Snowflake
- Fetches ALL claims using the main query
- Transforms data to standard format
- Saves to `data/claim_activities_full.csv`
- Creates sync tracking file

### Subsequent Runs (Incremental Updates)
- Reads existing claim numbers from local CSV
- Queries Snowflake for all current claim numbers
- Identifies new claims (not in local data)
- Fetches only new claims
- Appends to existing CSV file
- Updates sync tracking

## Files Created

- `data/claim_activities_full.csv` - Main data file with all claims
- `data/sync_tracking.csv` - Tracks last sync time and statistics
- `configurations/config.py` - Snowflake credentials (git-ignored)

## Manual Sync

To manually trigger a full data refresh:

```python
from snowflake_sync import sync_claims_data

# Force full refresh
sync_claims_data(force_full_refresh=True)
```

## Testing the Sync

Run the sync module directly to test:

```bash
cd dash_dashboard
python snowflake_sync.py
```

## Troubleshooting

### Connection Issues
- Verify credentials in `config.py`
- Check network connectivity to Snowflake
- Ensure your IP is whitelisted

### Data Mapping Issues
- Check column names in Snowflake match those in `transform_snowflake_data_to_claims_format()`
- Verify data types are compatible

### Missing Dependencies
```bash
pip install snowflake-connector-python pandas
```

## Integration with Dashboard

The sync runs automatically when the dashboard starts:
1. Checks for new claims
2. Fetches and adds them to local data
3. Dashboard loads the updated data
4. Displays sync status in console

To disable auto-sync, set `SNOWFLAKE_ENABLED = False` in `app.py`.
