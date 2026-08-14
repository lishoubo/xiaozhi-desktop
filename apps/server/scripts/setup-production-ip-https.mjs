import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_IP = '121.199.29.74';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const targetDirectory = path.join(repositoryRoot, 'output', 'production-tls', PRODUCTION_IP);

function openssl(arguments_) {
	execFileSync('openssl', arguments_, { stdio: 'inherit' });
}

if (process.argv.length > 2) {
	throw new Error('This command does not accept arguments; the production IP is repository-owned');
}
if (existsSync(targetDirectory)) {
	throw new Error(`Refusing to overwrite existing production TLS material: ${targetDirectory}`);
}

try {
	execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
	throw new Error('OpenSSL is required to generate production TLS certificates');
}

mkdirSync(path.dirname(targetDirectory), { recursive: true, mode: 0o700 });
const stagingDirectory = mkdtempSync(path.join(tmpdir(), 'hotel-butler-production-tls-'));
chmodSync(stagingDirectory, 0o700);

try {
	const caKey = path.join(stagingDirectory, 'ca-key.pem');
	const caCertificate = path.join(stagingDirectory, 'ca.pem');
	const serverKey = path.join(stagingDirectory, 'key.pem');
	const request = path.join(stagingDirectory, 'server.csr');
	const serverCertificate = path.join(stagingDirectory, 'cert.pem');
	const extensions = path.join(stagingDirectory, 'server-extensions.cnf');

	openssl([
		'req',
		'-x509',
		'-newkey',
		'rsa:3072',
		'-sha256',
		'-nodes',
		'-days',
		'3650',
		'-keyout',
		caKey,
		'-out',
		caCertificate,
		'-subj',
		'/O=Hotel Butler/CN=Hotel Butler Production CA',
		'-addext',
		'basicConstraints=critical,CA:TRUE,pathlen:0',
		'-addext',
		'keyUsage=critical,keyCertSign,cRLSign',
		'-addext',
		'subjectKeyIdentifier=hash'
	]);
	openssl([
		'req',
		'-new',
		'-newkey',
		'rsa:3072',
		'-sha256',
		'-nodes',
		'-keyout',
		serverKey,
		'-out',
		request,
		'-subj',
		`/O=Hotel Butler/CN=${PRODUCTION_IP}`,
		'-addext',
		`subjectAltName=IP:${PRODUCTION_IP}`
	]);
	writeFileSync(
		extensions,
		[
			'basicConstraints=critical,CA:FALSE',
			'keyUsage=critical,digitalSignature,keyEncipherment',
			'extendedKeyUsage=serverAuth',
			`subjectAltName=IP:${PRODUCTION_IP}`,
			'subjectKeyIdentifier=hash',
			'authorityKeyIdentifier=keyid,issuer',
			''
		].join('\n'),
		{ mode: 0o600 }
	);
	openssl([
		'x509',
		'-req',
		'-in',
		request,
		'-CA',
		caCertificate,
		'-CAkey',
		caKey,
		'-CAcreateserial',
		'-out',
		serverCertificate,
		'-days',
		'825',
		'-sha256',
		'-extfile',
		extensions
	]);
	openssl(['verify', '-CAfile', caCertificate, serverCertificate]);
	openssl(['x509', '-in', serverCertificate, '-checkip', PRODUCTION_IP, '-noout']);

	const finalStaging = path.join(stagingDirectory, PRODUCTION_IP);
	const serverDirectory = path.join(finalStaging, 'server');
	const desktopDirectory = path.join(finalStaging, 'desktop');
	mkdirSync(serverDirectory, { recursive: true, mode: 0o700 });
	mkdirSync(desktopDirectory, { recursive: true, mode: 0o700 });
	copyFileSync(caKey, path.join(finalStaging, 'ca-key.pem'));
	copyFileSync(caCertificate, path.join(serverDirectory, 'ca.pem'));
	copyFileSync(serverCertificate, path.join(serverDirectory, 'cert.pem'));
	copyFileSync(serverKey, path.join(serverDirectory, 'key.pem'));
	copyFileSync(caCertificate, path.join(desktopDirectory, 'private-ca.pem'));
	chmodSync(path.join(finalStaging, 'ca-key.pem'), 0o600);
	chmodSync(path.join(serverDirectory, 'key.pem'), 0o600);
	chmodSync(path.join(serverDirectory, 'ca.pem'), 0o644);
	chmodSync(path.join(serverDirectory, 'cert.pem'), 0o644);
	chmodSync(path.join(desktopDirectory, 'private-ca.pem'), 0o644);

	renameSync(finalStaging, targetDirectory);
	console.info(`Production TLS material created at ${targetDirectory}`);
	console.info(`Server certificate directory: ${path.join(targetDirectory, 'server')}`);
	console.info('Keep ca-key.pem and server/key.pem secret; never copy them into the desktop app.');
} finally {
	rmSync(stagingDirectory, { recursive: true, force: true });
}
