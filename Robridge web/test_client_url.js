const testClientUrl = (origin, envUrl, nodeEnv) => {
  let clientUrl = origin || envUrl || (nodeEnv === 'production'
    ? 'https://robridgelabs.com/bvs'
    : 'http://localhost:3000');

  const isLocalhost = clientUrl.includes('localhost') || clientUrl.includes('127.0.0.1');
  if (nodeEnv === 'production' && !isLocalhost && !clientUrl.endsWith('/bvs') && !clientUrl.includes('/bvs/')) {
    clientUrl = clientUrl.replace(/\/$/, '') + '/bvs';
  }
  return clientUrl;
};

console.log("1:", testClientUrl("http://localhost:3000", null, "development"));
console.log("2:", testClientUrl(undefined, null, "production"));
console.log("3:", testClientUrl("https://frontend.onrender.com", null, "production"));
console.log("4:", testClientUrl(null, "http://localhost:3000", "production"));
