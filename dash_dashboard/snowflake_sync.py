import snowflake.connector
import pandas as pd
import os
from datetime import datetime
from configurations.config import credentials

# Data directory path
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# Full data file path (stores all claims)
FULL_DATA_FILE = os.path.join(DATA_DIR, "claim_activities_full.csv")

# Tracking file to store last sync info
SYNC_TRACKING_FILE = os.path.join(DATA_DIR, "sync_tracking.csv")


def get_claim_numbers_from_process_data():
    """
    Get list of claim numbers from local process data files.
    Excludes Snowflake exposure data files.
    
    Returns:
        set: Set of claim numbers from process data
    """
    if not os.path.exists(DATA_DIR):
        print(f"Data directory not found: {DATA_DIR}")
        return set()
    
    # Get all CSV files excluding Snowflake/exposure data
    process_files = [
        f for f in os.listdir(DATA_DIR) 
        if f.endswith('.csv') 
        and 'snowflake' not in f.lower() 
        and 'sync_tracking' not in f.lower()
        and 'dummy_snowflake' not in f.lower()
        and 'claim_activities_full' not in f.lower()
    ]
    
    all_claims = set()
    
    for filename in process_files:
        try:
            filepath = os.path.join(DATA_DIR, filename)
            df = pd.read_csv(filepath, dtype={'Claim_Number': str})
            
            if 'Claim_Number' in df.columns:
                # Ensure claim numbers have leading zero
                claims = df['Claim_Number'].apply(
                    lambda x: x if str(x).startswith('0') else '0' + str(x)
                ).unique()
                all_claims.update(claims)
                print(f"Found {len(claims)} unique claims in {filename}")
        except Exception as e:
            print(f"Error reading {filename}: {e}")
    
    print(f"Total unique claims across all process data files: {len(all_claims)}")
    return all_claims


def get_claim_numbers_from_process_data():
    """
    Get list of claim numbers from local process data files.
    Excludes Snowflake exposure data files.
    
    Returns:
        set: Set of claim numbers from process data
    """
    if not os.path.exists(DATA_DIR):
        print(f"Data directory not found: {DATA_DIR}")
        return set()
    
    # Get all CSV files excluding Snowflake/exposure data
    process_files = [
        f for f in os.listdir(DATA_DIR) 
        if f.endswith('.csv') 
        and 'snowflake' not in f.lower() 
        and 'sync_tracking' not in f.lower()
        and 'dummy_snowflake' not in f.lower()
        and 'claim_activities_full' not in f.lower()
    ]
    
    all_claims = set()
    
    for filename in process_files:
        try:
            filepath = os.path.join(DATA_DIR, filename)
            df = pd.read_csv(filepath, dtype={'Claim_Number': str})
            
            if 'Claim_Number' in df.columns:
                # Ensure claim numbers have leading zero
                claims = df['Claim_Number'].apply(
                    lambda x: x if str(x).startswith('0') else '0' + str(x)
                ).unique()
                all_claims.update(claims)
                print(f"Found {len(claims)} unique claims in {filename}")
        except Exception as e:
            print(f"Error reading {filename}: {e}")
    
    print(f"Total unique claims across all process data files: {len(all_claims)}")
    return all_claims


def get_snowflake_connection():
    """
    Establish connection to Snowflake using credentials from config.
    
    Returns:
        snowflake.connector.connection: Active Snowflake connection
    """
    try:
        conn = snowflake.connector.connect(
            user=credentials["username"],
            password=credentials["password"],
            account=credentials["account"],
            warehouse=credentials["warehouse"],
            database=credentials["database"],
            schema=credentials["schema"]
        )
        print("Successfully connected to Snowflake")
        return conn
    except Exception as e:
        print(f"Error connecting to Snowflake: {e}")
        return None


def get_existing_claim_numbers():
    """
    Get list of claim numbers already in the local data file.
    
    Returns:
        set: Set of existing claim numbers
    """
    if os.path.exists(FULL_DATA_FILE):
        try:
            existing_df = pd.read_csv(FULL_DATA_FILE, dtype={'Claim_Number': str})
            # Ensure claim numbers have leading zero
            existing_df['Claim_Number'] = existing_df['Claim_Number'].apply(
                lambda x: x if x.startswith('0') else '0' + x
            )
            return set(existing_df['Claim_Number'].unique())
        except Exception as e:
            print(f"Error reading existing data: {e}")
            return set()
    return set()


def fetch_claims_from_snowflake(claim_numbers=None):
    """
    Fetch claim data from Snowflake.
    
    Args:
        claim_numbers (list): List of specific claim numbers to fetch. If None, fetches all.
    
    Returns:
        pd.DataFrame: DataFrame with claim data
    """
    conn = get_snowflake_connection()
    
    if conn is None:
        print("Failed to establish Snowflake connection")
        return None
    
    try:
        # Base query
        if claim_numbers and len(claim_numbers) > 0:
            # Format claim numbers for SQL IN clause
            claim_list = ','.join([f"'{num}'" for num in claim_numbers])
            
            sql_query = f"""
            SELECT *
            FROM "PL_PROD"."PM_EDW_PRES_CL_D"."LD_CLAIM_EXPOSURE_V" t1
            LEFT JOIN (
                SELECT *
                FROM "PL_PROD"."PM_EDW_PRES_CL_D"."LD_CLAIM_V"
                WHERE CLAIM_NBR IN ({claim_list})
                AND DM_CRRNT_ROW_IND = 'Y'
            ) t2 ON t1.CLAIM_NBR = t2.CLAIM_NBR
            WHERE t1.CLAIM_NBR IN ({claim_list})
            AND t1.DM_CRRNT_ROW_IND = 'Y';
            """
        else:
            # Fetch all claims (initial load)
            sql_query = """
            SELECT *
            FROM "PL_PROD"."PM_EDW_PRES_CL_D"."LD_CLAIM_EXPOSURE_V" t1
            LEFT JOIN (
                SELECT *
                FROM "PL_PROD"."PM_EDW_PRES_CL_D"."LD_CLAIM_V"
                WHERE DM_CRRNT_ROW_IND = 'Y'
            ) t2 ON t1.CLAIM_NBR = t2.CLAIM_NBR
            WHERE t1.DM_CRRNT_ROW_IND = 'Y';
            """
        
        print("Executing Snowflake query...")
        df = pd.read_sql(sql_query, conn)
        
        print(f"Fetched {len(df)} records from Snowflake")
        
        return df
        
    except Exception as e:
        print(f"Error fetching data from Snowflake: {e}")
        return None
    finally:
        conn.close()
        print("Snowflake connection closed")


def transform_snowflake_data_to_claims_format(df):
    """
    Transform Snowflake data to match the expected claim activities format.
    
    Args:
        df (pd.DataFrame): Raw data from Snowflake
    
    Returns:
        pd.DataFrame: Transformed data with columns: Claim_Number, Process, Activity, First_TimeStamp, Active_Minutes
    """
    # TODO: Map your Snowflake columns to the required format
    # This is a placeholder - adjust based on your actual Snowflake schema
    
    transformed_df = pd.DataFrame({
        'Claim_Number': df['CLAIM_NBR'].astype(str),  # Adjust column name as needed
        'Process': df['PROCESS_NAME'],  # Adjust column name as needed
        'Activity': df['ACTIVITY_NAME'],  # Adjust column name as needed
        'First_TimeStamp': pd.to_datetime(df['TIMESTAMP_COLUMN']),  # Adjust column name as needed
        'Active_Minutes': df['DURATION_MINUTES']  # Adjust column name as needed
    })
    
    # Ensure claim numbers have leading zero
    transformed_df['Claim_Number'] = transformed_df['Claim_Number'].apply(
        lambda x: x if x.startswith('0') else '0' + x
    )
    
    # Sort by claim number and timestamp
    transformed_df = transformed_df.sort_values(['Claim_Number', 'First_TimeStamp'])
    
    return transformed_df


def sync_claims_data(force_full_refresh=False):
    """
    Synchronize claims data from Snowflake to local CSV.
    Only fetches exposure data for claims that exist in local process data files.
    
    Args:
        force_full_refresh (bool): If True, re-fetches all data for existing claims
    
    Returns:
        bool: True if sync was successful, False otherwise
    """
    # Ensure data directory exists
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        print(f"Created data directory: {DATA_DIR}")
    
    try:
        # Get claim numbers from process data files
        print("Reading claim numbers from process data files...")
        process_claims = get_claim_numbers_from_process_data()
        
        if not process_claims:
            print("No claims found in process data files. Nothing to sync from Snowflake.")
            return False
        
        print(f"Fetching Snowflake exposure data for {len(process_claims)} claims...")
        
        # Convert set to list for query
        claim_list = list(process_claims)
        
        # Fetch data from Snowflake for these specific claims
        raw_df = fetch_claims_from_snowflake(claim_numbers=claim_list)
        
        if raw_df is None or raw_df.empty:
            print("No data fetched from Snowflake")
            return False
        
        # Save exposure data directly (no transformation needed for exposure data)
        # The dummy_snowflake_data.csv format is what we want to maintain
        output_file = os.path.join(DATA_DIR, "dummy_snowflake_data.csv")
        raw_df.to_csv(output_file, index=False)
        print(f"Saved {len(raw_df)} exposure records to {output_file}")
        print(f"Covers {raw_df['CLAIM_NBR'].nunique()} unique claims")
        
        # Update sync tracking
        update_sync_tracking(len(process_claims))
        
        return True
    
    except Exception as e:
        print(f"Error during sync: {e}")
        import traceback
        traceback.print_exc()
        return False


def update_sync_tracking(total_claims, new_claims=0):
    """
    Update sync tracking file with last sync information.
    
    Args:
        total_claims (int): Total number of claims synced
        new_claims (int): Number of new claims added (legacy parameter, not used)
    """
    sync_info = {
        'last_sync_timestamp': [datetime.now().strftime('%Y-%m-%d %H:%M:%S')],
        'total_claims': [total_claims],
        'claims_synced': [total_claims]
    }
    
    sync_df = pd.DataFrame(sync_info)
    sync_df.to_csv(SYNC_TRACKING_FILE, index=False)
    print(f"Updated sync tracking: {total_claims} claims synced from Snowflake")


def get_last_sync_info():

    """
    Get information about the last sync operation.
    
    Returns:
        dict: Dictionary with last sync info, or None if no sync has occurred
    """
    if os.path.exists(SYNC_TRACKING_FILE):
        try:
            sync_df = pd.read_csv(SYNC_TRACKING_FILE)
            return sync_df.iloc[-1].to_dict()
        except Exception as e:
            print(f"Error reading sync tracking: {e}")
            return None
    return None


if __name__ == "__main__":
    # Test the sync functionality
    print("Starting Snowflake data sync...")
    success = sync_claims_data()
    
    if success:
        print("\n✓ Sync completed successfully")
        sync_info = get_last_sync_info()
        if sync_info:
            print(f"Last sync: {sync_info['last_sync_timestamp']}")
            print(f"Total claims: {sync_info['total_claims']}")
            print(f"New claims added: {sync_info['new_claims_added']}")
    else:
        print("\n✗ Sync failed")
