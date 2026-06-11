require('dotenv').config();
const { Pool } = require('pg');
const request = require('supertest');
const bcrypt = require('bcrypt');
const { app } = require('../server');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runResetOtpTests() {
  console.log('🧪 STARTING PASSWORD RESET OTP FLOW INTEGRATION TESTS\n');
  const testEmail = 'reset_tester_' + Date.now() + '@test.com';
  const testPassword = 'OldPassword123!';
  const newPasswordOtp = 'NewPasswordOtp123!';
  const newPasswordLegacy = 'NewPasswordLegacy123!';
  const testName = 'Reset Tester';
  let testUserId = null;

  try {
    // 0. Seed test user
    console.log('📋 Setup: Seeding test user...');
    const hashedOldPassword = await bcrypt.hash(testPassword, 10);
    const seedRes = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified) 
       VALUES ($1, $2, $3, 'expo_user', TRUE) 
       RETURNING id`,
      [testEmail.toLowerCase(), hashedOldPassword, testName]
    );
    testUserId = seedRes.rows[0].id;
    console.log(`✅ Test user created with ID: ${testUserId}`);

    // 1. Test Forgot Password (OTP Generation)
    console.log('📋 Test 1: Requesting password reset OTP...');
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: testEmail });

    if (forgotRes.statusCode !== 200 || !forgotRes.body.success) {
      throw new Error(`Forgot password request failed: ${JSON.stringify(forgotRes.body)}`);
    }
    console.log('✅ Forgot password response returned success');

    // 2. Fetch generated reset OTP from database
    console.log('📋 Test 2: Fetching OTP from database...');
    const dbUserRes = await pool.query(
      'SELECT reset_password_token, reset_password_expires FROM users WHERE id = $1',
      [testUserId]
    );
    const dbUser = dbUserRes.rows[0];
    const generatedOtp = dbUser.reset_password_token;
    console.log(`✅ Reset OTP found in DB: ${generatedOtp}, Expiry: ${dbUser.reset_password_expires}`);
    if (!generatedOtp || generatedOtp.length !== 6) {
      throw new Error('Reset OTP was not generated as a 6-digit code');
    }

    // 3. Test verification with incorrect OTP
    console.log('📋 Test 3: Attempting reset with incorrect OTP...');
    const resetFailRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: testEmail, otp: '000000', newPassword: newPasswordOtp });

    console.log(`✅ Response status: ${resetFailRes.statusCode} (Expected: 400)`);
    if (resetFailRes.statusCode !== 400 || resetFailRes.body.success) {
      throw new Error('Reset did not fail with incorrect OTP');
    }

    // 4. Test verification with correct OTP
    console.log('📋 Test 4: Attempting reset with correct OTP...');
    const resetSuccessRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: testEmail, otp: generatedOtp, newPassword: newPasswordOtp });

    if (resetSuccessRes.statusCode !== 200 || !resetSuccessRes.body.success) {
      throw new Error(`Reset failed with correct OTP: ${JSON.stringify(resetSuccessRes.body)}`);
    }
    console.log('✅ Password reset successful via OTP');

    // Check DB state and verify password change
    const dbUserRes2 = await pool.query(
      'SELECT password_hash, reset_password_token, reset_password_expires FROM users WHERE id = $1',
      [testUserId]
    );
    const dbUser2 = dbUserRes2.rows[0];
    if (dbUser2.reset_password_token !== null) {
      throw new Error('Reset token/OTP fields were not cleared after successful reset');
    }
    const isNewPasswordValid = await bcrypt.compare(newPasswordOtp, dbUser2.password_hash);
    if (!isNewPasswordValid) {
      throw new Error('Password hash was not updated correctly in database');
    }
    console.log('✅ DB updated correctly and password hash verified');

    // 5. Test Legacy Token-based Reset Flow (Backward Compatibility)
    console.log('📋 Test 5: Setting legacy token in database manually...');
    const legacyToken = 'legacy_token_' + Math.random().toString(36).substring(2, 10);
    const legacyExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
    await pool.query(
      'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
      [legacyToken, legacyExpires, testUserId]
    );

    console.log('📋 Test 5.1: Attempting legacy reset using token parameter...');
    const legacyResetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: legacyToken, newPassword: newPasswordLegacy });

    if (legacyResetRes.statusCode !== 200 || !legacyResetRes.body.success) {
      throw new Error(`Legacy reset failed: ${JSON.stringify(legacyResetRes.body)}`);
    }
    console.log('✅ Legacy token-based password reset successful');

    // Check DB state and verify legacy password change
    const dbUserRes3 = await pool.query(
      'SELECT password_hash, reset_password_token, reset_password_expires FROM users WHERE id = $1',
      [testUserId]
    );
    const dbUser3 = dbUserRes3.rows[0];
    if (dbUser3.reset_password_token !== null) {
      throw new Error('Reset token/OTP fields were not cleared after legacy token reset');
    }
    const isLegacyPasswordValid = await bcrypt.compare(newPasswordLegacy, dbUser3.password_hash);
    if (!isLegacyPasswordValid) {
      throw new Error('Legacy password hash was not updated correctly in database');
    }
    console.log('✅ Legacy DB state updated correctly and password verified');

    console.log('\n🎉 ALL PASSWORD RESET OTP FLOW TESTS PASSED SUCCESSFULLY!');

  } catch (error) {
    console.error('❌ RESET OTP FLOW TEST FAILED:', error.message);
  } finally {
    // Cleanup
    if (testUserId) {
      try {
        console.log('🧹 Cleaning up test user...');
        await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
        console.log('✅ Cleanup complete');
      } catch (cleanupErr) {
        console.error('⚠️ Cleanup error:', cleanupErr.message);
      }
    }
    await pool.end();
  }
}

runResetOtpTests();
