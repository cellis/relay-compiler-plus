import yargs from 'yargs';
import 'babel-polyfill';
import path from 'path';
import fs from 'fs';
import RelayCompiler from 'relay-compiler';
import {getFilepathsFromGlob, getRelayFileWriter, getSchema} from './ripped';
import {clean} from './utils';
import {graphqlJSCompiler} from 'relay-compiler-plus/graphqlJSCompiler'; //eslint-disable-line
import {queryMap, persistQuery} from './persistQuery';

const {
  ConsoleReporter,
  Runner: CodegenRunner,
  FileIRParser: RelayJSModuleParser,
  WatchmanClient,
  DotGraphQLParser,
} = RelayCompiler;

function buildWatchExpression(options: {
  extensions: Array<string>,
  include: Array<string>,
  exclude: Array<string>,
}) {
  return [
    'allof',
    ['type', 'f'],
    ['anyof', ...options.extensions.map(ext => ['suffix', ext])],
    [
      'anyof',
      ...options.include.map(include => ['match', include, 'wholename']),
    ],
    ...options.exclude.map(exclude => ['not', ['match', exclude, 'wholename']]),
  ];
}

// Ensure that a watchman "root" file exists in the given directory
// or a parent so that it can be watched
const WATCHMAN_ROOT_FILES = ['.git', '.hg', '.watchmanconfig'];
function hasWatchmanRootFile(testPath) {
  while (path.dirname(testPath) !== testPath) {
    if (
      WATCHMAN_ROOT_FILES.some(file => {
        return fs.existsSync(path.join(testPath, file));
      })
    ) {
      return true;
    }
    testPath = path.dirname(testPath);
  }
  return false;
}

/*
* Most of the code in this run method are ripped from:
* relay-compiler/bin/RelayCompilerBin.js
*/
const run = async (options: {
  schema: string,
  src: string,
  webpackConfig: string,
  extensions: Array<string>,
  watch?: ?boolean,
}) => {
  const srcDir = path.resolve(process.cwd(), options.src);
  console.log(`src: ${srcDir}`);

  let schemaPath;
  let customWebpackConfig;

  if (options.webpackConfig) {
    customWebpackConfig = path.resolve(process.cwd(), options.webpackConfig);
  } else {
    schemaPath = path.resolve(process.cwd(), options.schema);
  }

  if ((schemaPath && path.extname(schemaPath) === '.js') || customWebpackConfig) {
    console.log(`schemaPath: ${schemaPath}, customWebpackConfig: ${customWebpackConfig}`);
    schemaPath = await graphqlJSCompiler(schemaPath, srcDir, customWebpackConfig);
  }

  if (options.watch && !options.watchman) {
    throw new Error('Watchman is required to watch for changes.');
  }

  if (options.watch && !hasWatchmanRootFile(srcDir)) {
    throw new Error(`
--watch requires that the src directory have a valid watchman "root" file.

Root files can include:
- A .git/ Git folder
- A .hg/ Mercurial folder
- A .watchmanconfig file

Ensure that one such file exists in ${srcDir} or its parents.
    `.trim(),
    );
  }

  const useWatchman = options.watchman && (await WatchmanClient.isAvailable());

  console.log(`schemaPath: ${schemaPath}`);
  clean(srcDir);

  const reporter = new ConsoleReporter({verbose: true});
  const parserConfigs = {
    js: {
      baseDir: srcDir,
      getFileFilter: RelayJSModuleParser.getFileFilter,
      getParser: RelayJSModuleParser.getParser,
      getSchema: () => getSchema(schemaPath),
      watchmanExpression: useWatchman ? buildWatchExpression(options) : null,
      filepaths: useWatchman ? null : getFilepathsFromGlob(srcDir, options),
    },
    graphql: {
      baseDir: srcDir,
      getParser: DotGraphQLParser.getParser,
      getSchema: () => getSchema(schemaPath),
      watchmanExpression: useWatchman ? buildWatchExpression({
        extensions: ['graphql'],
        include: options.include,
        exclude: options.exclude,
      }) : null,
      filepaths: useWatchman ? null :
        getFilepathsFromGlob(srcDir, {
          extensions: ['graphql'],
          include: options.include,
          exclude: options.exclude,
        }),
    },
  };

  const writerConfigs = {
    default: {
      getWriter: getRelayFileWriter(srcDir, persistQuery),
      isGeneratedFile: (filePath) =>
        filePath.endsWith('.js') && filePath.includes('__generated__'),
      parser: 'default',
    },
  };
  const codegenRunner = new CodegenRunner({
    reporter,
    parserConfigs,
    writerConfigs,
    onlyValidate: false,
  });

  let result = '';
  try {
    // the real work is done here
    result = options.watch ? await codegenRunner.watchAll() : await codegenRunner.compileAll();
  } catch (err) {
    console.log(`Error codegenRunner.compileAll(): ${err}`);
    throw err;
  }

  const queryMapOutputFile = `${srcDir}/queryMap.json`;
  try {
    fs.writeFileSync(queryMapOutputFile, JSON.stringify(queryMap));
    console.log(`Query map written to: ${queryMapOutputFile}`);
  } catch (err) {
    if (err) {
      return console.log(err);
    }
  }

  console.log(`Done! ${result}`);
};

// Collect args
const argv = yargs // eslint-disable-line prefer-destructuring
  .usage('Usage: $0 --schema <schemaPath> --src <srcDir>')
  .options({
    schema: {
      describe: 'Path to schema.js or schema.graphql or schema.json',
      demandOption: false,
      type: 'string',
    },
    include: {
      array: true,
      default: ['**'],
      describe: 'Directories to include under src',
      type: 'string',
    },
    exclude: {
      array: true,
      default: [
        '**/node_modules/**',
        '**/__mocks__/**',
        '**/__tests__/**',
        '**/__generated__/**',
      ],
      describe: 'Directories to ignore under src',
      type: 'string',
    },
    src: {
      describe: 'Root directory of application code',
      demandOption: true,
      type: 'string',
    },
    webpackConfig: {
      describe: 'Custom webpack config to compile graphql-js',
      demandOption: false,
      type: 'string',
    },
    watch: {
      describe: 'If specified, watches files and regenerates on changes',
      type: 'boolean',
    },
    extensions: {
      array: true,
      default: ['js', 'jsx'],
      describe: 'File extensions to compile (--extensions js jsx)',
      type: 'string',
    },
  })
  .help().argv;

(async () => {
  console.log('Welcome to relay-compiler-plus. Compiling now with these parameters:');
  try {
    await run(argv);
  } catch (err) {
    console.log(`error: ${err}`);
    process.exit(1);
  }
})();
