#!/usr/bin/env python3
import sqlite3
import json

def view_database():
    conn = sqlite3.connect('barcodes.db')
    cursor = conn.cursor()
    
    print("🔍 DATABASE CONTENTS")
    print("=" * 80)
    
    # Get total count
    cursor.execute("SELECT COUNT(*) FROM barcodes")
    total = cursor.fetchone()[0]
    print(f"Total Records: {total}")
    print()
    
    # Get all records
    cursor.execute('''
        SELECT barcode_id, barcode_data, barcode_type, file_path, 
               created_at, product_name, product_id, price, category, source
        FROM barcodes 
        ORDER BY created_at DESC
    ''')
    
    rows = cursor.fetchall()
    
    for i, row in enumerate(rows, 1):
        print(f"📱 RECORD #{i}")
        print("-" * 40)
        print(f"🆔 Barcode ID: {row[0]}")
        print(f"📝 Data: {row[1][:80]}{'...' if len(row[1]) > 80 else ''}")
        print(f"🔖 Type: {row[2]}")
        print(f"📁 File: {row[3]}")
        print(f"⏰ Created: {row[4]}")
        print(f"📦 Product: {row[5] or 'N/A'}")
        print(f"🆔 Product ID: {row[6] or 'N/A'}")
        print(f"💰 Price: {row[7] or 'N/A'}")
        print(f"🏷️ Category: {row[8] or 'N/A'}")
        print(f"📱 Source: {row[9] or 'N/A'}")
        print()
    
    conn.close()

if __name__ == "__main__":
    view_database()
