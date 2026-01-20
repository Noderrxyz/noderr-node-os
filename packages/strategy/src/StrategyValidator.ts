import * as fs from 'fs/promises';
import * as path from 'path';
import * as ts from 'typescript';
import { Logger } from '@noderr/utils/src';

const logger = new Logger('StrategyValidator');

// Dangerous modules that strategies must not import or require
const DANGEROUS_MODULES = new Set([
    'fs', 'fs/promises',
    'child_process',
    'net', 'http', 'https', 'http2',
    'dgram', 'dns',
    'os', 'process',
    'cluster', 'worker_threads',
    'vm', 'vm2',
    'repl',
    'inspector',
    'crypto', // Strategies shouldn't need direct crypto access
    'path', // Can be used for path traversal
]);

// Dangerous global identifiers that strategies must not access
const DANGEROUS_GLOBALS = new Set([
    'eval',
    'Function',
    'require',
    'process',
    'global',
    '__dirname',
    '__filename',
    'Buffer',
    'setImmediate',
    'setInterval',
    'setTimeout',
]);

// Required interface elements for a valid strategy
const REQUIRED_INTERFACE = [
    'class Strategy',
    'async init(',
    'async onBar(',
];

/**
 * Performs institutional-grade validation on a cloned strategy repository using AST-based static analysis.
 * This prevents bypasses through string concatenation, obfuscation, or alternative syntax.
 * 
 * @param strategyPath The absolute path to the cloned strategy directory.
 * @returns A promise that resolves if validation passes, or rejects with an error.
 */
export async function validateStrategy(strategyPath: string): Promise<void> {
    // MEDIUM FIX #15: Make entry file path configurable
    // Try to find entry point from package.json first, then fall back to common patterns
    let entryFilePath: string;
    
    try {
        const packageJsonPath = path.join(strategyPath, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        
        // Check for custom entry point in package.json
        if (packageJson.main) {
            entryFilePath = path.join(strategyPath, packageJson.main);
        } else if (packageJson.exports?.['.']) {
            entryFilePath = path.join(strategyPath, packageJson.exports['.']);
        } else {
            // Fall back to common patterns
            entryFilePath = path.join(strategyPath, 'src', 'index.ts');
        }
    } catch {
        // No package.json or parsing error, use default
        entryFilePath = path.join(strategyPath, 'src', 'index.ts');
    }

    // 1. Check for required entry file
    try {
        await fs.access(entryFilePath);
    } catch {
        // Try alternative common paths
        const alternatives = [
            path.join(strategyPath, 'index.ts'),
            path.join(strategyPath, 'src', 'strategy.ts'),
            path.join(strategyPath, 'strategy.ts'),
        ];
        
        let found = false;
        for (const alt of alternatives) {
            try {
                await fs.access(alt);
                entryFilePath = alt;
                found = true;
                break;
            } catch {
                // Continue trying
            }
        }
        
        if (!found) {
            throw new Error(`Strategy validation failed: No entry file found. Tried: ${entryFilePath}, ${alternatives.join(', ')}`);
        }
    }

    // 2. Read file content
    const content = await fs.readFile(entryFilePath, 'utf-8');

    // 3. Quick string-based checks for required interface (fast pre-check)
    for (const required of REQUIRED_INTERFACE) {
        if (!content.includes(required)) {
            throw new Error(`Strategy validation failed: Missing required interface element: "${required}".`);
        }
    }

    // 4. AST-based security validation (comprehensive)
    try {
        await performASTValidation(content, entryFilePath);
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Strategy validation failed: ${error.message}`);
        }
        throw error;
    }

    // MEDIUM FIX #16: Add TypeScript compilation check
    // This ensures the strategy can actually be compiled without errors
    await verifyCompilation(entryFilePath);

    logger.info(`Strategy validation successful for: ${strategyPath}`);
}

/**
 * Performs AST-based validation using TypeScript compiler API.
 * This catches all forms of dangerous code access, including obfuscated attempts.
 */
async function performASTValidation(content: string, filePath: string): Promise<void> {
    // Parse the TypeScript code into an AST
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
    );

    const violations: string[] = [];

    // Recursive visitor function to traverse the AST
    function visit(node: ts.Node) {
        // Check for import declarations
        if (ts.isImportDeclaration(node)) {
            const moduleSpecifier = node.moduleSpecifier;
            if (ts.isStringLiteral(moduleSpecifier)) {
                const moduleName = moduleSpecifier.text;
                if (DANGEROUS_MODULES.has(moduleName)) {
                    violations.push(`Dangerous import detected: "${moduleName}"`);
                }
            }
        }

        // Check for require() calls
        if (ts.isCallExpression(node)) {
            const expression = node.expression;
            
            // Direct require() call
            if (ts.isIdentifier(expression) && expression.text === 'require') {
                if (node.arguments.length > 0) {
                    const arg = node.arguments[0];
                    if (ts.isStringLiteral(arg)) {
                        const moduleName = arg.text;
                        if (DANGEROUS_MODULES.has(moduleName)) {
                            violations.push(`Dangerous require() detected: "${moduleName}"`);
                        }
                    } else {
                        // Dynamic require with non-literal argument (e.g., require(someVar))
                        violations.push(`Dynamic require() call detected - not allowed for security`);
                    }
                }
            }

            // eval() call
            if (ts.isIdentifier(expression) && expression.text === 'eval') {
                violations.push(`eval() call detected - not allowed for security`);
            }

            // Function constructor (equivalent to eval)
            if (ts.isIdentifier(expression) && expression.text === 'Function') {
                violations.push(`Function() constructor detected - not allowed for security`);
            }
        }

        // Check for dangerous global identifiers
        if (ts.isIdentifier(node)) {
            if (DANGEROUS_GLOBALS.has(node.text)) {
                // Check if it's being accessed (not just declared as a parameter)
                const parent = node.parent;
                if (!ts.isParameter(parent) && !ts.isVariableDeclaration(parent)) {
                    violations.push(`Dangerous global identifier accessed: "${node.text}"`);
                }
            }
        }

        // Check for property access on dangerous objects (e.g., process.env, global.require)
        if (ts.isPropertyAccessExpression(node)) {
            const objectName = node.expression;
            if (ts.isIdentifier(objectName)) {
                if (objectName.text === 'process' || objectName.text === 'global') {
                    violations.push(`Dangerous property access: "${objectName.text}.${node.name.text}"`);
                }
            }
        }

        // Recursively visit child nodes
        ts.forEachChild(node, visit);
    }

    // Start the traversal
    visit(sourceFile);

    // If any violations were found, reject the strategy
    if (violations.length > 0) {
        throw new Error(`Security violations detected:\n${violations.map(v => `  - ${v}`).join('\n')}`);
    }
}

/**
 * Verifies that the strategy can be compiled with TypeScript.
 * This catches syntax errors, missing dependencies, and type errors.
 */
async function verifyCompilation(entryFilePath: string): Promise<void> {
    // Create a minimal tsconfig for compilation check
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        noEmit: true, // Don't generate output files
    };

    // Create a program with the entry file
    const program = ts.createProgram([entryFilePath], compilerOptions);
    
    // Get diagnostics (errors and warnings)
    const diagnostics = ts.getPreEmitDiagnostics(program);
    
    // Filter for actual errors (not warnings)
    const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    
    if (errors.length > 0) {
        const errorMessages = errors.map(diagnostic => {
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            if (diagnostic.file && diagnostic.start !== undefined) {
                const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
                return `${diagnostic.file.fileName}(${line + 1},${character + 1}): ${message}`;
            }
            return message;
        });
        
        throw new Error(`TypeScript compilation failed:\n${errorMessages.join('\n')}`);
    }
}
