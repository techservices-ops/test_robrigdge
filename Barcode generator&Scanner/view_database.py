#!/usr/bin/env python3
"""
Database Viewer Script for Robridge Barcode System
Shows all data from both barcode generator and other sources
"""

import sqlite3
import os
from datetime import datetime
import json

def connect_to_database():
    """Connect to the SQLite database"""
    db_path = "barcodes.db"
    if not os.path.exists(db_path):
        print(f"❌ Database file '{db_path}' not found!")
        return None
    
    try:
        conn = sqlite3.connect(db_path)
        return conn
    except sqlite3.Error as e:
        print(f"❌ Error connecting to database: {e}")
        return None

def get_table_info(conn):
    """Get information about all tables in the database"""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    return [table[0] for table in tables]

def show_table_structure(conn, table_name):
    """Show the structure of a specific table"""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name});")
    columns = cursor.fetchall()
    
    print(f"\n📋 Table Structure: {table_name}")
    print("=" * 50)
    print(f"{'Column':<20} {'Type':<15} {'NotNull':<8} {'Default':<10}")
    print("-" * 50)
    
    for col in columns:
        not_null = "YES" if col[3] else "NO"
        default = str(col[4]) if col[4] else "NULL"
        print(f"{col[1]:<20} {col[2]:<15} {not_null:<8} {default:<10}")

def show_barcode_data(conn):
    """Show all barcode data with detailed information"""
    cursor = conn.cursor()
    
    # Get total count
    cursor.execute("SELECT COUNT(*) as total FROM barcodes")
    total_count = cursor.fetchone()[0]
    
    print(f"\n🔖 BARCODE DATA (Total: {total_count})")
    print("=" * 80)
    
    if total_count == 0:
        print("No barcodes found in database.")
        return
    
    # Get all barcode data with correct column names
    cursor.execute("""
        SELECT 
            id,
            barcode_id,
            barcode_data,
            barcode_type,
            source,
            product_name,
            product_id,
            price,
            location_x,
            location_y,
            location_z,
            category,
            file_path,
            metadata,
            created_at
        FROM barcodes 
        ORDER BY created_at DESC
    """)
    
    barcodes = cursor.fetchall()
    
    for i, barcode in enumerate(barcodes, 1):
        print(f"\n📱 Barcode #{i}")
        print("-" * 40)
        print(f"🆔 ID: {barcode[0]}")
        print(f"🔖 Barcode ID: {barcode[1] or 'N/A'}")
        print(f"📝 Data: {barcode[2] or 'N/A'}")
        print(f"🔖 Type: {barcode[3] or 'N/A'}")
        print(f"📱 Source: {barcode[4] or 'N/A'}")
        print(f"📦 Product: {barcode[5] or 'N/A'}")
        print(f"🆔 Product ID: {barcode[6] or 'N/A'}")
        print(f"💰 Price: ${barcode[7] or 'N/A'}")
        print(f"📍 Location: X:{barcode[8] or 'N/A'}, Y:{barcode[9] or 'N/A'}, Z:{barcode[10] or 'N/A'}")
        print(f"🏷️ Category: {barcode[11] or 'N/A'}")
        print(f"🖼️ File: {barcode[12] or 'N/A'}")
        print(f"📋 Metadata: {barcode[13] or 'N/A'}")
        print(f"⏰ Created: {barcode[14] or 'N/A'}")

def show_statistics(conn):
    """Show database statistics"""
    cursor = conn.cursor()
    
    print(f"\n📊 DATABASE STATISTICS")
    print("=" * 50)
    
    # Total barcodes
    cursor.execute("SELECT COUNT(*) as total FROM barcodes")
    total = cursor.fetchone()[0]
    print(f"📱 Total Barcodes: {total}")
    
    # By type
    cursor.execute("SELECT barcode_type, COUNT(*) as count FROM barcodes GROUP BY barcode_type")
    type_stats = cursor.fetchall()
    print(f"\n🔖 By Type:")
    for stat in type_stats:
        print(f"   {stat[0] or 'Unknown'}: {stat[1]}")
    
    # By source
    cursor.execute("SELECT source, COUNT(*) as count FROM barcodes GROUP BY source")
    source_stats = cursor.fetchall()
    print(f"\n📱 By Source:")
    for stat in source_stats:
        print(f"   {stat[0] or 'Unknown'}: {stat[1]}")
    
    # By category
    cursor.execute("SELECT category, COUNT(*) as count FROM barcodes GROUP BY category")
    category_stats = cursor.fetchall()
    print(f"\n🏷️ By Category:")
    for stat in category_stats:
        print(f"   {stat[0] or 'Unknown'}: {stat[1]}")
    
    # Date range
    cursor.execute("SELECT MIN(created_at) as earliest, MAX(created_at) as latest FROM barcodes")
    date_range = cursor.fetchone()
    if date_range[0] and date_range[1]:
        print(f"\n📅 Date Range:")
        print(f"   Earliest: {date_range[0]}")
        print(f"   Latest: {date_range[1]}")

def show_recent_activity(conn, limit=10):
    """Show recent barcode generation activity"""
    cursor = conn.cursor()
    
    print(f"\n🕒 RECENT ACTIVITY (Last {limit})")
    print("=" * 60)
    
    cursor.execute("""
        SELECT 
            id,
            barcode_type,
            barcode_data,
            product_name,
            source,
            created_at
        FROM barcodes 
        ORDER BY created_at DESC 
        LIMIT ?
    """, (limit,))
    
    recent = cursor.fetchall()
    
    if not recent:
        print("No recent activity found.")
        return
    
    for barcode in recent:
        try:
            created_time = datetime.fromisoformat(barcode[5].replace('Z', '+00:00'))
            time_ago = datetime.now().replace(tzinfo=created_time.tzinfo) - created_time
            time_str = f"{time_ago.days}d ago"
        except:
            time_str = "Unknown time"
        
        print(f"\n🔖 {barcode[1] or 'Unknown'} Barcode")
        print(f"   Data: {barcode[2] or 'N/A'}")
        print(f"   Product: {barcode[3] or 'N/A'}")
        print(f"   Source: {barcode[4] or 'N/A'}")
        print(f"   Time: {barcode[5] or 'N/A'} ({time_str})")

def export_to_json(conn, filename="database_export.json"):
    """Export all database data to JSON file"""
    cursor = conn.cursor()
    
    print(f"\n💾 EXPORTING TO JSON: {filename}")
    print("=" * 50)
    
    cursor.execute("SELECT * FROM barcodes")
    barcodes = cursor.fetchall()
    
    # Get column names
    cursor.execute("PRAGMA table_info(barcodes)")
    columns = [col[1] for col in cursor.fetchall()]
    
    # Convert to list of dictionaries
    data = []
    for barcode in barcodes:
        barcode_dict = dict(zip(columns, barcode))
        data.append(barcode_dict)
    
    # Write to JSON file
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"✅ Exported {len(data)} records to {filename}")

def main():
    """Main function to display all database information"""
    print("🚀 ROBRIDGE DATABASE VIEWER")
    print("=" * 50)
    print(f"📅 Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Connect to database
    conn = connect_to_database()
    if not conn:
        return
    
    try:
        # Show database overview
        tables = get_table_info(conn)
        print(f"\n📊 Database Tables: {', '.join(tables)}")
        
        # Show table structure
        for table in tables:
            show_table_structure(conn, table)
        
        # Show barcode data
        show_barcode_data(conn)
        
        # Show statistics
        show_statistics(conn)
        
        # Show recent activity
        show_recent_activity(conn)
        
        # Export to JSON
        export_to_json(conn)
        
    except sqlite3.Error as e:
        print(f"❌ Database error: {e}")
    finally:
        conn.close()
        print(f"\n✅ Database connection closed")

if __name__ == "__main__":
    main()
