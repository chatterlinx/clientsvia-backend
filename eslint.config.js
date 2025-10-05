export default [
  {
    ignores: [
      'node_modules/**',
      'logs/**',
      'public/**',
      '*.min.js',
      'coverage/**',
      '.nyc_output/**',
      'dist/**',
      'build/**',
      '*.config.js'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly'
      }
    },
    rules: {
      // Production-grade rules
      'no-console': 'error', // No console.log in production code
      'no-debugger': 'error', // No debugger statements
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error', // Use const/let instead of var
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',

      // Node.js specific (basic rules)
      'no-process-env': 'off', // We need process.env for configuration
      'no-process-exit': 'off', // Server.js needs process.exit

      // Code quality rules
      'complexity': ['warn', 15], // Warn on functions with high cyclomatic complexity
      'max-depth': ['warn', 4], // Warn on deeply nested code
      'max-lines': ['warn', 500], // Warn on very long files
      'max-lines-per-function': ['warn', 100], // Warn on very long functions
      'max-params': ['warn', 5], // Warn on functions with too many parameters
      'no-else-return': 'error', // Eliminate else after return
      'no-lonely-if': 'error', // Eliminate useless if statements
      'no-nested-ternary': 'error', // Avoid nested ternary operators
      'no-unneeded-ternary': 'error', // Avoid unnecessary ternary operators
      'no-duplicate-imports': 'error',
      'no-useless-rename': 'error',
      'object-shorthand': 'error',
      'quote-props': ['error', 'as-needed'],

      // Error handling
      'handle-callback-err': 'error',
      'no-new': 'warn', // Warn on constructor calls without assignment
      'no-shadow': 'error',
      'no-use-before-define': ['error', { functions: false }],

      // Async/await best practices
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'warn',
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'error',

      // Best practices
      'curly': ['error', 'all'], // Require curly braces for all control statements
      'default-case': 'error', // Require default case in switch statements
      'default-case-last': 'error', // Default case must be last
      'default-param-last': 'error', // Default parameters must be last
      'dot-notation': 'error', // Use dot notation when possible
      'eqeqeq': ['error', 'always'], // Require === and !==
      'grouped-accessor-pairs': 'error', // Group getter/setter pairs
      'no-alert': 'error', // No alert() calls
      'no-caller': 'error', // No arguments.callee or arguments.caller
      'no-constructor-return': 'error', // No return from constructor
      'no-div-regex': 'error', // No division operator in regex
      'no-eq-null': 'error', // No == null or != null
      'no-eval': 'error', // No eval()
      'no-extend-native': 'error', // No extending native objects
      'no-extra-bind': 'error', // No unnecessary function binding
      'no-extra-label': 'error', // No unnecessary labels
      'no-floating-decimal': 'error', // No .5 instead of 0.5
      'no-implicit-coercion': 'error', // No implicit type coercion
      'no-implicit-globals': 'error', // No implicit global variables
      'no-invalid-this': 'error', // No invalid this usage
      'no-iterator': 'error', // No __iterator__ property
      'no-label-var': 'error', // No variable with same name as label
      'no-labels': 'error', // No labels
      'no-lone-blocks': 'error', // No unnecessary blocks
      'no-loop-func': 'error', // No function declarations in loops
      'no-magic-numbers': ['warn', {
        ignore: [-1, 0, 1, 2, 10, 100, 1000, 24, 60],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true
      }],
      'no-multi-str': 'error', // No multiline strings
      'no-new-func': 'error', // No new Function()
      'no-new-object': 'error', // No new Object()
      'no-new-wrappers': 'error', // No new String/Number/Boolean
      'no-octal-escape': 'error', // No octal escape sequences
      'no-proto': 'error', // No __proto__ access
      'no-redeclare': 'error', // No variable redeclaration
      'no-regex-spaces': 'error', // No multiple spaces in regex
      'no-return-assign': 'error', // No return with assignment
      'no-script-url': 'error', // No javascript: URLs
      'no-self-compare': 'error', // No self-comparison
      'no-sequences': 'error', // No comma operator
      'no-throw-literal': 'error', // No throw with non-Error objects
      'no-unmodified-loop-condition': 'error', // No unmodified loop conditions
      'no-unused-expressions': 'error', // No unused expressions
      'no-useless-call': 'error', // No unnecessary function calls
      'no-useless-computed-key': 'error', // No unnecessary computed property keys
      'no-useless-concat': 'error', // No unnecessary string concatenation
      'no-useless-constructor': 'error', // No unnecessary constructors
      'no-useless-escape': 'error', // No unnecessary escape characters
      'no-useless-rename': 'error', // No unnecessary renaming in destructuring
      'no-useless-return': 'error', // No unnecessary return statements
      'no-void': 'error', // No void operator
      'no-warning-comments': 'warn', // Warn on TODO, FIXME, etc.
      'no-with': 'error', // No with statements
      'radix': 'error', // Require radix for parseInt
      'require-await': 'error', // Require async functions to use await
      'require-unicode-regexp': 'off', // Unicode regex flags not widely supported yet
      'require-yield': 'error', // Require generator functions to use yield
      'strict': ['error', 'global'], // Require strict mode
      'symbol-description': 'error', // Require symbol descriptions
      'yoda': 'error' // No Yoda conditions
    }
  },
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/tests/**/*.js'],
    rules: {
      'no-console': 'off', // Allow console in tests
      'security/detect-child-process': 'off', // Allow in tests
      'node/no-extraneous-require': 'off' // Allow dev dependencies in tests
    }
  }
];
