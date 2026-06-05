#!/usr/bin/env python3
import sqlite3
from datetime import datetime

def check_server_database():
    try:
        conn = sqlite3.connect('barcodes.db')
        cursor = conn.cursor()
        
        # Get total records
        cursor.execute('SELECT COUNT(*) FROM barcodes')
        total_records = cursor.fetchone()[0]
        print(f"Total records: {total_records}")
        
        # Get source breakdown
        cursor.execute('SELECT source, COUNT(*) FROM barcodes GROUP BY source')
        source_breakdown = cursor.fetchall()
        print("\nSource breakdown:")
        for source, count in source_breakdown:
            print(f"  {source}: {count} records")
        
        # Get recent 5 records
        cursor.execute('SELECT * FROM barcodes ORDER BY created_at DESC LIMIT 5')
        recent_records = cursor.fetchall()
        print("\nRecent 5 records:")
        print("-" * 60)
        
        for record in recent_records:
            id_val, barcode_id, barcode_data, barcode_type, source, product_name, product_id, price, location_x, location_y, location_z, category, file_path, metadata, created_at = record
            print(f"ID: {id_val}")
            print(f"  Barcode ID: {barcode_id}")
            print(f"  Data: {barcode_data[:40]}{'...' if len(barcode_data) > 40 else ''}")
            print(f"  Type: {barcode_type}")
            print(f"  Source: {source}")
            print(f"  Product: {product_name}")
            print(f"  Category: {category}")
            print(f"  Price: ${price}")
            print(f"  Created: {created_at}")
            print("-" * 30)
        
        # Check for ESP32 scans specifically
        cursor.execute("SELECT COUNT(*) FROM barcodes WHERE source = 'esp32'")
        esp32_count = cursor.fetchone()[0]
        print(f"\nESP32 scans: {esp32_count} records")
        
        # Check for recent ESP32 activity
        cursor.execute("""
            SELECT COUNT(*) FROM barcodes 
            WHERE source = 'esp32' AND created_at >= datetime('now', '-7 days')
        """)
        recent_esp32 = cursor.fetchone()[0]
        print(f"Recent ESP32 activity (last 7 days): {recent_esp32} scans")
        
        conn.close()
        print("\nDatabase check completed!")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_server_database()
