require('dotenv').config();
const { Pool } = require('pg');
const request = require('supertest');
const { app } = require('../server');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runOtpTests() {
  console.log('🧪 STARTING OTP FLOW INTEGRATION TESTS\n');
  const testEmail = 'otp_tester_' + Date.now() + '@test.com';
  const testPassword = 'Password123!';
  const testName = 'OTP Tester';

  try {
    // 1. Test Registration
    console.log('📋 Test 1: Registering user...');
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: testPassword, name: testName });

    if (registerRes.statusCode !== 200) {
      throw new Error(`Registration failed: ${JSON.stringify(registerRes.body)}`);
    }

    console.log('✅ Registration responded successfully');
    const { requiresVerification, email } = registerRes.body;
    if (!requiresVerification || email !== testEmail.toLowerCase()) {
      throw new Error('Registration response missing verification requirements');
    }

    // 2. Fetch generated OTP from database
    console.log('📋 Test 2: Checking database for generated OTP...');
    const dbUserRes = await pool.query(
      'SELECT id, otp_code, otp_expires, email_verified FROM users WHERE email = $1',
      [testEmail.toLowerCase()]
    );

    if (dbUserRes.rows.length === 0) {
      throw new Error('User not found in database after registration');
    }

    const dbUser = dbUserRes.rows[0];
    console.log(`✅ User found in DB. OTP Code: ${dbUser.otp_code}, Expiry: ${dbUser.otp_expires}`);
    if (!dbUser.otp_code || dbUser.otp_code.length !== 6 || dbUser.email_verified) {
      throw new Error('OTP was not correctly generated or user is already verified');
    }

    // 3. Test verification with incorrect OTP
    console.log('📋 Test 3: Verifying with incorrect OTP...');
    const verifyFailRes = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, otp: '000000' });

    console.log(`✅ Response status: ${verifyFailRes.statusCode} (Expected: 400)`);
    if (verifyFailRes.statusCode !== 400 || verifyFailRes.body.success) {
      throw new Error('Verification did not fail with incorrect OTP');
    }

    // 4. Test resending OTP
    console.log('📋 Test 4: Requesting new OTP...');
    const resendRes = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: testEmail });

    if (resendRes.statusCode !== 200 || !resendRes.body.success) {
      throw new Error(`Failed to resend OTP: ${JSON.stringify(resendRes.body)}`);
    }

    // Fetch new OTP from database
    const dbUserRes2 = await pool.query(
      'SELECT otp_code, otp_expires FROM users WHERE email = $1',
      [testEmail.toLowerCase()]
    );
    const newOtp = dbUserRes2.rows[0].otp_code;
    console.log(`✅ New OTP Code generated: ${newOtp}`);
    if (newOtp === dbUser.otp_code) {
      throw new Error('Resend OTP did not generate a new code');
    }

    // 5. Test verification with correct OTP
    console.log('📋 Test 5: Verifying with correct new OTP...');
    const verifySuccessRes = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: testEmail, otp: newOtp });

    if (verifySuccessRes.statusCode !== 200 || !verifySuccessRes.body.success) {
      throw new Error(`Verification failed with correct OTP: ${JSON.stringify(verifySuccessRes.body)}`);
    }

    console.log('✅ Verification successful');
    const { token, user } = verifySuccessRes.body;
    if (!token || !user || user.email !== testEmail.toLowerCase()) {
      throw new Error('Verification success response did not return token and user profile');
    }

    // Verify database state has been updated
    const dbUserRes3 = await pool.query(
      'SELECT email_verified, otp_code, otp_expires FROM users WHERE email = $1',
      [testEmail.toLowerCase()]
    );
    const dbUser3 = dbUserRes3.rows[0];
    if (!dbUser3.email_verified || dbUser3.otp_code !== null) {
      throw new Error('Database was not correctly updated after successful verification');
    }
    console.log('✅ Database state updated correctly');

    console.log('\n🎉 ALL OTP FLOW TESTS PASSED SUCCESSFULLY!');

  } catch (error) {
    console.error('❌ OTP FLOW TEST FAILED:', error.message);
  } finally {
    // Cleanup
    try {
      console.log('🧹 Cleaning up test user...');
      await pool.query('DELETE FROM users WHERE email = $1', [testEmail.toLowerCase()]);
      console.log('✅ Cleanup complete');
    } catch (cleanupErr) {
      console.error('⚠️ Cleanup error:', cleanupErr.message);
    }
    await pool.end();
  }
}

runOtpTests();
