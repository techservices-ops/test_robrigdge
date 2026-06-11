const request = require('supertest');
const { app, pool } = require('../server');
const bcrypt = require('bcrypt');

describe('Security & Audit Compliance API Tests', () => {
  let adminToken;
  let managerToken;
  let adminUser, managerUser;
  let workspaceId;
  let masterId;
  let itemId;

  beforeAll(async () => {
    // 1. Clean up existing test data
    await pool.query("DELETE FROM ims_audit_log");
    await pool.query("DELETE FROM ims_items");
    await pool.query("DELETE FROM ims_masters");
    await pool.query("DELETE FROM ims_settings");
    await pool.query("DELETE FROM ims_workspace_members");
    await pool.query("DELETE FROM ims_workspaces");
    await pool.query("DELETE FROM users WHERE email LIKE 'test-compliance-%'");

    // 2. Create Users
    const passwordHash = await bcrypt.hash('TestPassword123!', 10);
    
    // Admin user (will be Owner of the workspace)
    const adminRes = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ('test-compliance-admin@robridge.com', $1, 'Admin User', 'expo_user', true)
       RETURNING id`,
      [passwordHash]
    );
    adminUser = adminRes.rows[0];

    // Manager user
    const managerRes = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ('test-compliance-manager@robridge.com', $1, 'Manager User', 'expo_user', true)
       RETURNING id`,
      [passwordHash]
    );
    managerUser = managerRes.rows[0];

    // 3. Create Workspace
    const wsRes = await pool.query(
      `INSERT INTO ims_workspaces (name, owner_id)
       VALUES ('Test Compliance Workspace', $1)
       RETURNING id`,
      [adminUser.id]
    );
    workspaceId = wsRes.rows[0].id;

    // 4. Add Members & Roles
    await pool.query(
      `INSERT INTO ims_workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, adminUser.id]
    );

    await pool.query(
      `INSERT INTO ims_workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'manager')`,
      [workspaceId, managerUser.id]
    );

    // 5. Insert initial workspace settings (Manager Approval = false, Immutable Logs = false, blockUnpaired = true, restrictRobot = true)
    await pool.query(
      `INSERT INTO ims_settings (user_id, workspace_id, preferences)
       VALUES ($1, $2, $3)`,
      [adminUser.id, workspaceId, JSON.stringify({
        alerts: { email: true },
        security: { managerApproval: false, immutableLogs: false, blockUnpaired: true, restrictRobot: true, supervisorPin: '9999' }
      })]
    );

    // 6. Log in to get Tokens
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test-compliance-admin@robridge.com', password: 'TestPassword123!' });
    adminToken = adminLogin.body.token;

    const managerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test-compliance-manager@robridge.com', password: 'TestPassword123!' });
    managerToken = managerLogin.body.token;

    // 7. Create a Master Catalog
    const masterRes = await request(app)
      .post('/api/ims/masters')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ name: 'Compliance Test Master', category: 'General' });
    masterId = masterRes.body.master.id;

    // 8. Create an Item in the Catalog
    const itemRes = await request(app)
      .post(`/api/ims/masters/${masterId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ barcode: 'COMP-001', name: 'Compliance Item', stock: 10, category: 'General' });
    itemId = itemRes.body.item.id;
  });

  afterAll(async () => {
    // Clean up
    await pool.query("DELETE FROM ims_items");
    await pool.query("DELETE FROM ims_masters");
    await pool.query("DELETE FROM ims_settings");
    await pool.query("DELETE FROM ims_workspace_members");
    await pool.query("DELETE FROM ims_workspaces");
    await pool.query("DELETE FROM users WHERE email LIKE 'test-compliance-%'");
    await pool.end();
  });

  test('Manager Approval overrides stock checks', async () => {
    // A. Verify stock edit works without PIN when overrides are disabled
    let res = await request(app)
      .put(`/api/ims/masters/${masterId}/items/${itemId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ barcode: 'COMP-001', name: 'Compliance Item', stock: 20 });
    expect(res.statusCode).toEqual(200);

    // B. Enable manager override approval (PIN: 9999)
    await pool.query(
      `UPDATE ims_settings SET preferences = $1 WHERE workspace_id = $2`,
      [JSON.stringify({
        alerts: { email: true },
        security: { managerApproval: true, immutableLogs: false, blockUnpaired: true, restrictRobot: true, supervisorPin: '9999' }
      }), workspaceId]
    );

    // C. Non-admin user (manager) edits stock without PIN -> should fail
    res = await request(app)
      .put(`/api/ims/masters/${masterId}/items/${itemId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ barcode: 'COMP-001', name: 'Compliance Item', stock: 30 });
    expect(res.statusCode).toEqual(403);
    expect(res.body.error).toContain('Manager Overrides is enabled');

    // D. Non-admin user (manager) edits stock with WRONG PIN -> should fail
    res = await request(app)
      .put(`/api/ims/masters/${masterId}/items/${itemId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ barcode: 'COMP-001', name: 'Compliance Item', stock: 30, supervisorPin: '1111' });
    expect(res.statusCode).toEqual(403);

    // E. Non-admin user (manager) edits stock with CORRECT PIN -> should succeed
    res = await request(app)
      .put(`/api/ims/masters/${masterId}/items/${itemId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ barcode: 'COMP-001', name: 'Compliance Item', stock: 30, supervisorPin: '9999' });
    expect(res.statusCode).toEqual(200);

    // F. Admin user edits stock without PIN -> should succeed (bypasses PIN)
    res = await request(app)
      .put(`/api/ims/masters/${masterId}/items/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ barcode: 'COMP-001', name: 'Compliance Item', stock: 40 });
    expect(res.statusCode).toEqual(200);
  });

  test('Immutable Audit Trail locks catalog deletion', async () => {
    // A. Disable Immutable logs -> deletion should succeed (we'll make a temporary master to test)
    const tempMasterRes = await request(app)
      .post('/api/ims/masters')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-workspace-id', workspaceId)
      .send({ name: 'Temp Master', category: 'General' });
    const tempMasterId = tempMasterRes.body.master.id;

    // Enable Immutable logs
    await pool.query(
      `UPDATE ims_settings SET preferences = $1 WHERE workspace_id = $2`,
      [JSON.stringify({
        alerts: { email: true },
        security: { managerApproval: true, immutableLogs: true, blockUnpaired: true, restrictRobot: true, supervisorPin: '9999' }
      }), workspaceId]
    );

    // Attempt deletion -> should fail
    let res = await request(app)
      .delete(`/api/ims/masters/${tempMasterId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-workspace-id', workspaceId);
    expect(res.statusCode).toEqual(403);
    expect(res.body.error).toContain('Immutable Audit Trail is enabled');

    // Disable Immutable logs
    await pool.query(
      `UPDATE ims_settings SET preferences = $1 WHERE workspace_id = $2`,
      [JSON.stringify({
        alerts: { email: true },
        security: { managerApproval: true, immutableLogs: false, blockUnpaired: true, restrictRobot: true, supervisorPin: '9999' }
      }), workspaceId]
    );

    // Attempt deletion -> should succeed
    res = await request(app)
      .delete(`/api/ims/masters/${tempMasterId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-workspace-id', workspaceId);
    expect(res.statusCode).toEqual(200);
  });

  test('Block Unpaired Scans policy restricts scans from unpaired devices', async () => {
    const testDeviceId = 'unpaired-test-device-999';

    // A. Enable Block Unpaired Scans
    await pool.query(
      `UPDATE ims_settings SET preferences = $1 WHERE workspace_id = $2`,
      [JSON.stringify({
        alerts: { email: true },
        security: { managerApproval: true, immutableLogs: false, blockUnpaired: true, restrictRobot: true, supervisorPin: '9999' }
      }), workspaceId]
    );

    // B. Attempt scan from unpaired device -> should be blocked with 403 Forbidden
    let res = await request(app)
      .post(`/api/esp32/scan/${testDeviceId}`)
      .send({ barcodeData: '999999999', scanType: 'inventory', timestamp: Date.now() });
    expect(res.statusCode).toEqual(403);
    expect(res.body.error).toContain('Access denied: Scanning device is not paired to any active workspace.');

    // C. Disable Block Unpaired Scans
    await pool.query(
      `UPDATE ims_settings SET preferences = $1 WHERE workspace_id = $2`,
      [JSON.stringify({
        alerts: { email: true },
        security: { managerApproval: true, immutableLogs: false, blockUnpaired: false, restrictRobot: true, supervisorPin: '9999' }
      }), workspaceId]
    );

    // D. Attempt scan from unpaired device -> should succeed with 200 OK
    res = await request(app)
      .post(`/api/esp32/scan/${testDeviceId}`)
      .send({ barcodeData: '999999999', scanType: 'inventory', timestamp: Date.now() });
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toEqual(true);
  });

  test('Audit logging covers critical operations', async () => {
    // Fetch logs for our workspace
    const auditRes = await pool.query(
      `SELECT action, entity_type FROM ims_audit_log WHERE workspace_id = $1 ORDER BY id DESC`,
      [workspaceId]
    );
    const actions = auditRes.rows.map(r => r.action);
    const entityTypes = auditRes.rows.map(r => r.entity_type);

    expect(actions).toContain('create_master');
    expect(actions).toContain('create_item');
    expect(actions).toContain('update_item');
    expect(actions).toContain('delete_master');
  });
});
