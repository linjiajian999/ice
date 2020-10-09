import * as path from 'path';
import * as fse from 'fs-extra';
import * as chokidar from 'chokidar';
import { IPlugin } from '@alib/build-scripts';
import { getProjectType, getRoutesInfo } from 'ice-project-utils';
import { IRouterOptions } from './types/router';
import walker from './collector/walker';

// compatible with $ice/routes
const TEM_ROUTER_COMPATIBLE = '$ice/routes';
const TEM_ROUTER_SETS = [TEM_ROUTER_COMPATIBLE];

const plugin: IPlugin = ({ context, onGetWebpackConfig, modifyUserConfig, getValue, applyMethod, registerUserConfig }) => {
  const { rootDir, userConfig, command } = context;
  const { mpa, disableRuntime } = userConfig;
  // [enum] js or ts
  const projectType = getValue('PROJECT_TYPE') || getProjectType(rootDir);

  // .tmp path
  const iceTempPath = getValue('TEMP_PATH') || path.join(rootDir, '.ice');
  const routerOptions = (userConfig.router || {}) as IRouterOptions;
  const { configPath } = routerOptions;
  const routesTempPath = path.join(iceTempPath, `routes.${projectType}`);
  const srcDir = !disableRuntime ? applyMethod('getSourceDir', userConfig.entry) : 'src';
  const getRoutesParams = {
    rootDir,
    tempDir: iceTempPath,
    configPath,
    projectType,
    isMpa: mpa as boolean,
    srcDir
  };
  const { routesPath, isConfigRoutes } = !disableRuntime ? applyMethod('getRoutes', getRoutesParams) : getRoutesInfo(getRoutesParams);
  // add babel plugins for ice lazy
  modifyUserConfig('babelPlugins',
    [
      ...(userConfig.babelPlugins as [] || []),
      [
        require.resolve('./babelPluginLazy'),
        { routesPath }
      ]
    ]);

  // copy templates and export react-router-dom/history apis to ice
  const routerTemplatesPath = path.join(__dirname, '../templates');
  const routerTargetPath = path.join(iceTempPath, 'router');
  fse.ensureDirSync(routerTargetPath);
  fse.copySync(routerTemplatesPath, routerTargetPath);
  // copy types
  fse.copySync(path.join(__dirname, '../src/types/index.ts'), path.join(iceTempPath, 'router/types/index.ts'));
  fse.copySync(path.join(__dirname, '../src/types/base.ts'), path.join(iceTempPath, 'router/types/base.ts'));

  if (!disableRuntime) {
    applyMethod('addExport', { source: './router' });
    // set IAppRouterProps to IAppConfig
    applyMethod('addAppConfigTypes', { source: './router/types', specifier: '{ IAppRouterProps }', exportName: 'router?: IAppRouterProps' });
    // export IRouterConfig to the public
    applyMethod('addTypesExport', { source: './router/types' });
  }
  // modify webpack config
  onGetWebpackConfig((config) => {
    // add alias
    TEM_ROUTER_SETS.forEach(i => {
      config.resolve.alias.set(i, routesPath);
    });
    // alias for runtime/Router
    config.resolve.alias.set('$ice/Router', path.join(__dirname, 'runtime/Router'));

    // alias for runtime/history
    config.resolve.alias.set('$ice/history', path.join(iceTempPath, 'router/history'));

    // alias for runtime/ErrorBoundary
    config.resolve.alias.set('$ice/ErrorBoundary', path.join(iceTempPath, 'ErrorBoundary'));

    // alias for react-router-dom
    if (!disableRuntime) {
      // do not lock react-router-dom, in case of project dependency
      const routerName = 'react-router-dom';
      config.resolve.alias.set(routerName, require.resolve(routerName));
    }

    // config historyApiFallback for router type browser
    config.devServer.set('historyApiFallback', true);
  });

  // register router in build.json
  registerUserConfig({
    name: 'router',
    validation: 'object',
  });

  // do not watch folder pages when route config is exsits
  if (!isConfigRoutes) {
    const routerMatch = 'src/pages';
    const pagesDir = path.join(rootDir, routerMatch);
    const walkerOptions = { rootDir, routerOptions, routesTempPath, pagesDir };
    walker(walkerOptions);
    if (command === 'start') {
      // watch folder change when dev
      if (!disableRuntime) {
        applyMethod('watchFileChange', routerMatch, () => {
          walker(walkerOptions);
        });
      } else {
        // watch file change by chokidar when disable runtime
        chokidar.watch(path.join(rootDir, routerMatch), {
          ignoreInitial: true,
        }).on('all', () => {
          walker(walkerOptions);
        });
      }
    }
  }
};

export default plugin;
