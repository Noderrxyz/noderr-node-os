#!/usr/bin/env node
/**
 * Upload Release CLI
 * 
 * Command-line tool for uploading Noderr Node OS releases to Cloudflare R2.
 * 
 * Usage:
 *   npm run upload-release -- --version 0.2.0 --tier oracle --file ./noderr-oracle-0.2.0.tar
 * 
 * Options:
 *   --version <version>  Release version (e.g., 0.2.0)
 *   --tier <tier>        Node tier (base|oracle|guardian|all)
 *   --file <path>        Path to Docker image tarball
 *   --dry-run            Simulate upload without actually uploading
 * 
 * Environment Variables:
 *   R2_ACCOUNT_ID        Cloudflare R2 account ID
 *   R2_ACCESS_KEY_ID     R2 access key ID
 *   R2_SECRET_ACCESS_KEY R2 secret access key
 *   R2_BUCKET_NAME       R2 bucket name
 *   R2_PUBLIC_URL        Public URL for R2 bucket
 * 
 * @module UploadReleaseCLI
 */

import { R2UploadService } from '../services/r2-upload.service';
import * as fs from 'fs';
import * as path from 'path';

interface CLIArgs {
  version: string;
  tier: 'base' | 'oracle' | 'guardian' | 'all';
  file: string;
  dryRun: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<CLIArgs> = { dryRun: false };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--version':
        parsed.version = args[++i];
        break;
      case '--tier':
        parsed.tier = args[++i] as any;
        break;
      case '--file':
        parsed.file = args[++i];
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        printHelp();
        process.exit(1);
    }
  }
  
  // Validate required arguments
  if (!parsed.version || !parsed.tier || !parsed.file) {
    console.error('Error: Missing required arguments');
    printHelp();
    process.exit(1);
  }
  
  // Validate tier
  const validTiers = ['base', 'oracle', 'guardian', 'all'];
  if (!validTiers.includes(parsed.tier!)) {
    console.error(`Error: Invalid tier "${parsed.tier}". Must be one of: ${validTiers.join(', ')}`);
    process.exit(1);
  }
  
  return parsed as CLIArgs;
}

function printHelp() {
  console.log(`
Upload Release CLI - Noderr Node OS

Upload Docker image tarballs to Cloudflare R2 for distribution.

Usage:
  npm run upload-release -- --version <version> --tier <tier> --file <path>

Options:
  --version <version>  Release version (e.g., 0.2.0)
  --tier <tier>        Node tier (base|oracle|guardian|all)
  --file <path>        Path to Docker image tarball
  --dry-run            Simulate upload without actually uploading
  --help, -h           Show this help message

Environment Variables:
  R2_ACCOUNT_ID        Cloudflare R2 account ID
  R2_ACCESS_KEY_ID     R2 access key ID
  R2_SECRET_ACCESS_KEY R2 secret access key
  R2_BUCKET_NAME       R2 bucket name
  R2_PUBLIC_URL        Public URL for R2 bucket

Examples:
  # Upload Oracle node release
  npm run upload-release -- --version 0.2.0 --tier oracle --file ./noderr-oracle-0.2.0.tar
  
  # Dry run (simulate upload)
  npm run upload-release -- --version 0.2.0 --tier guardian --file ./noderr-guardian-0.2.0.tar --dry-run
  
  # Upload all tiers
  for tier in base oracle guardian all; do
    npm run upload-release -- --version 0.2.0 --tier $tier --file ./noderr-$tier-0.2.0.tar
  done
`);
}

function validateEnvironment(): void {
  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Error: Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nPlease set these variables in your .env file or environment.');
    process.exit(1);
  }
}

async function main() {
  console.log('========================================');
  console.log('Noderr Node OS - Upload Release');
  console.log('========================================\n');
  
  const args = parseArgs();
  
  console.log('Configuration:');
  console.log(`  Version: ${args.version}`);
  console.log(`  Tier: ${args.tier}`);
  console.log(`  File: ${args.file}`);
  console.log(`  Dry Run: ${args.dryRun ? 'Yes' : 'No'}\n`);
  
  // Validate file exists
  if (!fs.existsSync(args.file)) {
    console.error(`Error: File not found: ${args.file}`);
    process.exit(1);
  }
  
  const fileStats = fs.statSync(args.file);
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
  console.log(`File size: ${fileSizeMB} MB\n`);
  
  if (args.dryRun) {
    console.log('✓ Dry run successful - file exists and is readable');
    console.log('✓ No upload performed (--dry-run flag set)\n');
    return;
  }
  
  // Validate environment
  validateEnvironment();
  
  // Initialize R2 service
  const r2Service = new R2UploadService({
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!,
    publicUrl: process.env.R2_PUBLIC_URL!,
  });
  
  // Check if version already exists
  console.log('Checking if version already exists...');
  const exists = await r2Service.versionExists(args.version, args.tier);
  
  if (exists) {
    console.warn(`⚠ Warning: Version ${args.version} for tier ${args.tier} already exists in R2`);
    console.warn('Continuing will overwrite the existing file.\n');
  }
  
  // Upload
  console.log('Starting upload...\n');
  
  try {
    const result = await r2Service.uploadDockerImage({
      version: args.version,
      tier: args.tier,
      filePath: args.file,
      metadata: {
        'upload-date': new Date().toISOString(),
        'upload-tool': 'upload-release-cli',
        'sha256': '', // Will be calculated during upload
      },
    });
    
    console.log('\n========================================');
    console.log('✓ Upload Complete!');
    console.log('========================================\n');
    console.log('Upload Details:');
    console.log(`  URL: ${result.url}`);
    console.log(`  Checksum (SHA-256): ${result.checksum}`);
    console.log(`  Size: ${(result.size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Upload Time: ${(result.uploadTime / 1000).toFixed(2)}s\n`);
    
    console.log('Next Steps:');
    console.log('  1. Update VersionBeacon contract with new version');
    console.log('  2. Test deployment on canary nodes');
    console.log('  3. Monitor health metrics before rolling out to cohorts\n');
    
  } catch (error) {
    console.error('\n========================================');
    console.error('✗ Upload Failed');
    console.error('========================================\n');
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run CLI
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
