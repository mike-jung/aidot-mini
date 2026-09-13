import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { ROOT } from '../config.js';

export function tlsOptions(settings) {
  if (!settings.https) return undefined;
  if (!settings.certFile || !settings.keyFile) throw new Error('HTTPS requires TLS_CERT_FILE and TLS_KEY_FILE');
  const cert = fs.readFileSync(path.resolve(ROOT, settings.certFile));
  const key = fs.readFileSync(path.resolve(ROOT, settings.keyFile));
  const x = new X509Certificate(cert);
  if (Date.parse(x.validTo) <= Date.now() || Date.parse(x.validFrom) > Date.now()) throw new Error('TLS certificate is expired or not yet valid');
  const options = { cert, key, minVersion:'TLSv1.2' };
  tls.createSecureContext(options); // Also rejects a certificate/private-key mismatch.
  return options;
}
