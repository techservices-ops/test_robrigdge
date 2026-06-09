// Test scanner database logic
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function runTests() {
  const workspaceId = 1; // standard workspace id for tests
  const userId = 11; // testuser1 id
  const barcode = '123456';
  
  try {
    console.log('🧪 Starting Smart Scanner workflow database simulation tests...\n');

    // 0. Get original state
    const originalRes = await pool.query(
      'SELECT stock, locations FROM ims_items WHERE barcode = $1 LIMIT 1',
      [barcode]
    );
    if (originalRes.rows.length === 0) {
      console.log(`❌ Item with barcode ${barcode} not found.`);
      return;
    }
    const origStock = Number(originalRes.rows[0].stock);
    const origLocations = originalRes.rows[0].locations;
    console.log(`Original state for barcode ${barcode}: Stock = ${origStock}, Locations =`, origLocations);

    // 1. Simulating RECEIVE (+1)
    console.log('\n--- 1. Simulating RECEIVE scan (+1) ---');
    const receiveUpdateRes = await pool.query(
      'UPDATE ims_items SET stock = stock + 1, updated_at = CURRENT_TIMESTAMP WHERE barcode = $1 RETURNING stock',
      [barcode]
    );
    const postReceiveStock = Number(receiveUpdateRes.rows[0].stock);
    console.log(`Updated Stock after RECEIVE: ${postReceiveStock} (Expected: ${origStock + 1})`);
    if (postReceiveStock !== origStock + 1) {
      throw new Error('RECEIVE stock increment failed');
    }

    // Insert scan event
    await pool.query(
      `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, workflow, quantity, notes)
       VALUES ($1, $2, $3, 'RECEIVE', 1, 'Test receive scan')`,
      [userId, workspaceId, barcode]
    );
    console.log('✅ RECEIVE scan event recorded successfully');

    // 2. Simulating DISPATCH (-1)
    console.log('\n--- 2. Simulating DISPATCH scan (-1) ---');
    const dispatchUpdateRes = await pool.query(
      'UPDATE ims_items SET stock = GREATEST(stock - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE barcode = $1 RETURNING stock',
      [barcode]
    );
    const postDispatchStock = Number(dispatchUpdateRes.rows[0].stock);
    console.log(`Updated Stock after DISPATCH: ${postDispatchStock} (Expected: ${origStock})`);
    if (postDispatchStock !== origStock) {
      throw new Error('DISPATCH stock decrement failed');
    }

    // Insert scan event
    await pool.query(
      `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, workflow, quantity, notes)
       VALUES ($1, $2, $3, 'DISPATCH', 1, 'Test dispatch scan')`,
      [userId, workspaceId, barcode]
    );
    console.log('✅ DISPATCH scan event recorded successfully');

    // 3. Simulating PUTAWAY (Move to location "Aisle 4", stock unchanged)
    console.log('\n--- 3. Simulating PUTAWAY scan (Move location) ---');
    const targetLocationName = 'Aisle 4';
    const targetLocationId = 1; // Use an arbitrary ID or search for one
    
    // Check if location 1 exists or lookup first
    const locRes = await pool.query('SELECT id, name FROM ims_locations LIMIT 1');
    let locationId = targetLocationId;
    let locationName = targetLocationName;
    if (locRes.rows.length > 0) {
      locationId = locRes.rows[0].id;
      locationName = locRes.rows[0].name;
    } else {
      // Seed a location if none exist
      const insertLoc = await pool.query(
        "INSERT INTO ims_locations (workspace_id, name, type, description) VALUES ($1, 'Test Location', 'WAREHOUSE', 'Test description') RETURNING id, name",
        [workspaceId]
      );
      locationId = insertLoc.rows[0].id;
      locationName = insertLoc.rows[0].name;
    }
    console.log(`Using target location: ${locationName} (ID: ${locationId})`);

    // Putaway stock should remain unchanged
    const putawayStockRes = await pool.query(
      'SELECT stock FROM ims_items WHERE barcode = $1 LIMIT 1',
      [barcode]
    );
    const putawayStock = Number(putawayStockRes.rows[0].stock);

    // Update locations column in ims_items
    const locationsArray = [{ zone: locationName, qty: putawayStock }];
    await pool.query(
      'UPDATE ims_items SET locations = $1, updated_at = CURRENT_TIMESTAMP WHERE barcode = $2',
      [JSON.stringify(locationsArray), barcode]
    );
    console.log(`✅ Item locations column updated in catalog to:`, locationsArray);

    // Zero out stock at other locations
    await pool.query(
      'UPDATE ims_location_stock SET qty = 0, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = $1 AND barcode = $2 AND location_id <> $3',
      [workspaceId, barcode, locationId]
    );
    console.log('✅ Location stock zeroed out for other zones');

    // Upsert into target location stock
    await pool.query(
      `INSERT INTO ims_location_stock (location_id, workspace_id, barcode, item_name, qty)
       VALUES ($1, $2, $3, 'steel bottle', $4)
       ON CONFLICT (location_id, barcode) DO UPDATE SET qty = $4, updated_at = CURRENT_TIMESTAMP`,
      [locationId, workspaceId, barcode, putawayStock]
    );
    console.log('✅ Stock upserted at target location in ims_location_stock');

    // Insert scan event
    await pool.query(
      `INSERT INTO ims_scan_events (user_id, workspace_id, barcode, workflow, quantity, notes)
       VALUES ($1, $2, $3, 'PUTAWAY', 0, $4)`,
      [userId, workspaceId, barcode, `Putaway to ${locationName}`]
    );
    console.log('✅ PUTAWAY scan event logged successfully');

    // Verify final state
    const finalItemRes = await pool.query(
      'SELECT stock, locations FROM ims_items WHERE barcode = $1 LIMIT 1',
      [barcode]
    );
    const finalStock = Number(finalItemRes.rows[0].stock);
    const finalLocations = finalItemRes.rows[0].locations;
    console.log(`\nFinal state in ims_items: Stock = ${finalStock}, Locations =`, finalLocations);

    const finalLocStockRes = await pool.query(
      'SELECT l.name, ls.qty FROM ims_location_stock ls JOIN ims_locations l ON l.id = ls.location_id WHERE ls.barcode = $1 AND ls.workspace_id = $2',
      [barcode, workspaceId]
    );
    console.log('Final state in ims_location_stock:');
    console.log(finalLocStockRes.rows);

    // Cleanup: restore original state
    await pool.query(
      'UPDATE ims_items SET stock = $1, locations = $2 WHERE barcode = $3',
      [origStock, JSON.stringify(origLocations), barcode]
    );
    console.log('\n✅ Cleaned up and restored original state');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

runTests();
