import boto3
import os
import threading
from botocore.client import Config

# Configuration
ENDPOINT_URL = 'https://idr01.zata.ai'
ACCESS_KEY = 'H9QQ9Z3YR1J4GTUHA30P'
SECRET_KEY = 'HOdlcbPZkhBYGQkc5xmIYtp700NlAovhN78Jus3i'
BUCKET_NAME = 'devstoragev1'
EXPORT_DIR = 'zata_export'

def download_file(s3_client, bucket, key, local_path, size):
    try:
        if os.path.exists(local_path):
            local_size = os.path.getsize(local_path)
            if local_size == size:
                print(f"Skipping {key} (already exists)" + " " * 20, end='\r')
                return
            else:
                try:
                    os.remove(local_path)
                except OSError:
                    pass

        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        
        # Retry logic for transient errors
        retries = 3
        for attempt in range(retries):
            try:
                s3_client.download_file(bucket, key, local_path)
                # Clear line before printing download success to keep it clean
                print(f"Downloaded: {key}" + " " * 20)
                return
            except Exception as e:
                if attempt == retries - 1:
                    print(f"\nError downloading {key}: {e}")
                else:
                    import time
                    time.sleep(1)
    except Exception as e:
        print(f"\nError downloading {key}: {e}")

def main():
    # Initialize S3 client
    s3 = boto3.client('s3',
                      endpoint_url=ENDPOINT_URL,
                      aws_access_key_id=ACCESS_KEY,
                      aws_secret_access_key=SECRET_KEY,
                      config=Config(signature_version='s3v4'))

    print(f"Connecting to {ENDPOINT_URL}...")
    
    # List objects
    try:
        paginator = s3.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=BUCKET_NAME)
        
        objects = []
        for page in pages:
            if 'Contents' in page:
                for obj in page['Contents']:
                    objects.append({'Key': obj['Key'], 'Size': obj['Size']})
        
        print(f"Found {len(objects)} objects. Starting download to '{EXPORT_DIR}'...")
        
        total_objects = len(objects)
        for i, obj in enumerate(objects, 1):
            key = obj['Key']
            size = obj['Size']
            local_path = os.path.join(EXPORT_DIR, key)
            
            # Simple progress indicator
            print(f"[{i}/{total_objects}] Processing: {key}", end='\r')
            
            try:
               download_file(s3, BUCKET_NAME, key, local_path, size)
            except KeyboardInterrupt:
               print("\nExport paused by user. To resume, run the script again.")
               return

        print("\nExport completed.")
        
    except Exception as e:
        print(f"\nAn error occurred: {e}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExport paused by user.")

