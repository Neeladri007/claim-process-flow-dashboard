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
    On first run, fetches all claims. On subsequent runs, only fetches new claims.
    
    Args:
        force_full_refresh (bool): If True, fetches all data regardless of existing data
    
    Returns:
        bool: True if sync was successful, False otherwise
    """
    # Ensure data directory exists
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        print(f"Created data directory: {DATA_DIR}")
    
    try:
        if force_full_refresh or not os.path.exists(FULL_DATA_FILE):
            # Full refresh - fetch all claims
            print("Performing full data sync from Snowflake...")
            raw_df = fetch_claims_from_snowflake()
            
            if raw_df is None or raw_df.empty:
                print("No data fetched from Snowflake")
                return False
            
            # Transform data
            claims_df = transform_snowflake_data_to_claims_format(raw_df)
            
            # Save to CSV
            claims_df.to_csv(FULL_DATA_FILE, index=False)
            print(f"Saved {len(claims_df)} records to {FULL_DATA_FILE}")
            
            # Update sync tracking
            update_sync_tracking(len(claims_df['Claim_Number'].unique()))
            
            return True
        
        else:
            # Incremental sync - only fetch new claims
            print("Checking for new claims...")
            existing_claims = get_existing_claim_numbers()
            print(f"Found {len(existing_claims)} existing claims in local data")
            
            # TODO: Get list of all claim numbers from Snowflake to compare
            # For now, we'll assume you have a way to get the full list
            # This could be a separate lightweight query
            
            # Placeholder: Get all claim numbers from Snowflake
            conn = get_snowflake_connection()
            if conn is None:
                return False
            
            try:
                # Query to get all claim numbers (lightweight)
                all_claims_query = """
                SELECT DISTINCT CLAIM_NBR
                FROM "PL_PROD"."PM_EDW_PRES_CL_D"."LD_CLAIM_V"
                WHERE DM_CRRNT_ROW_IND = 'Y';
                """
                all_claims_df = pd.read_sql(all_claims_query, conn)
                all_claims_df['CLAIM_NBR'] = all_claims_df['CLAIM_NBR'].astype(str).apply(
                    lambda x: x if x.startswith('0') else '0' + x
                )
                all_claims_in_snowflake = set(all_claims_df['CLAIM_NBR'].tolist())
                
                conn.close()
                
                # Find new claims
                new_claims = all_claims_in_snowflake - existing_claims
                
                if len(new_claims) == 0:
                    print("No new claims to sync")
                    return True
                
                print(f"Found {len(new_claims)} new claims to fetch")
                
                # Fetch only new claims
                raw_df = fetch_claims_from_snowflake(list(new_claims))
                
                if raw_df is None or raw_df.empty:
                    print("No new data fetched")
                    return True
                
                # Transform new data
                new_claims_df = transform_snowflake_data_to_claims_format(raw_df)
                
                # Load existing data
                existing_df = pd.read_csv(FULL_DATA_FILE, dtype={'Claim_Number': str})
                
                # Append new data
                combined_df = pd.concat([existing_df, new_claims_df], ignore_index=True)
                combined_df = combined_df.sort_values(['Claim_Number', 'First_TimeStamp'])
                
                # Save updated data
                combined_df.to_csv(FULL_DATA_FILE, index=False)
                print(f"Added {len(new_claims_df)} new records. Total: {len(combined_df)} records")
                
                # Update sync tracking
                update_sync_tracking(len(combined_df['Claim_Number'].unique()), len(new_claims))
                
                return True
                
            except Exception as e:
                print(f"Error during incremental sync: {e}")
                if conn:
                    conn.close()
                return False
    
    except Exception as e:
        print(f"Error during sync: {e}")
        return False


def update_sync_tracking(total_claims, new_claims=0):
    """
    Update sync tracking file with last sync information.
    
    Args:
        total_claims (int): Total number of claims in the database
        new_claims (int): Number of new claims added in this sync
    """
    sync_info = {
        'last_sync_timestamp': [datetime.now().strftime('%Y-%m-%d %H:%M:%S')],
        'total_claims': [total_claims],
        'new_claims_added': [new_claims]
    }
    
    sync_df = pd.DataFrame(sync_info)
    sync_df.to_csv(SYNC_TRACKING_FILE, index=False)
    print(f"Updated sync tracking: {total_claims} total claims, {new_claims} new")


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
