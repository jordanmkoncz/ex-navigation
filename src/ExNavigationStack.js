/**
 * @flow
 */

import React from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import PropTypes from 'prop-types';
import NavigationExperimental from './navigation-experimental';

import _ from 'lodash';
import invariant from 'invariant';
import cloneReferencedElement from 'react-clone-referenced-element';
import PureComponent from './utils/PureComponent';
import { debounce } from 'core-decorators';

import Actions from './ExNavigationActions';
import NavigationBar from './ExNavigationBar';
import NavigationItem from './ExNavigationStackItem';

import { getBackButtonManager } from './ExNavigationBackButtonManager';
import { createNavigatorComponent } from './ExNavigationComponents';
import ExNavigatorContext from './ExNavigatorContext';
import ExNavigationAlertBar from './ExNavigationAlertBar';
import * as NavigationStyles from './ExNavigationStyles';
import SharedElementGroup
  from './shared-element/ExNavigationSharedElementGroup';
import { isIPhoneX, isNewIPadPro } from './utils/safeAreaUtils';

const { Transitioner: NavigationTransitioner } = NavigationExperimental;

import type {
  NavigationSceneRendererProps,
  NavigationScene,
  NavigationTransitionProps,
} from './navigation-experimental/NavigationTypeDefinition';
import type {
  ExNavigationRoute,
  ExNavigationRouter,
} from './ExNavigationRouter';
import type ExNavigationContext from './ExNavigationContext';
import type { ExNavigationConfig } from './ExNavigationTypeDefinition';
import type { ExNavigationTabContext } from './tab/ExNavigationTab';

const DEFAULT_ROUTE_CONFIG: ExNavigationConfig = {
  styles: Platform.OS === 'ios'
    ? NavigationStyles.SlideHorizontal
    : NavigationStyles.Fade,
};

let DEFAULT_STATUSBAR_HEIGHT;

if (isNewIPadPro) {
  DEFAULT_STATUSBAR_HEIGHT = 24;
} else if (Platform.OS === 'ios') {
  DEFAULT_STATUSBAR_HEIGHT = 20;
} else {
  DEFAULT_STATUSBAR_HEIGHT = 25;
}

const STATUSBAR_HEIGHT = Platform.OS === 'ios'
  ? DEFAULT_STATUSBAR_HEIGHT
  : global.__exponent ? DEFAULT_STATUSBAR_HEIGHT : 0;

const IPHONE_X_EXTRA_HEIGHT = isIPhoneX ? 20 : 0;

type TransitionFn = (
  transitionProps: NavigationTransitionProps,
  prevTransitionProps: NavigationTransitionProps
) => void;

type Props = {
  augmentScene?: (scene: ReactElement<any>, route: Object) => ReactElement<any>,
  defaultRouteConfig?: ExNavigationConfig,
  id: string,
  initialRoute?: ExNavigationRoute,
  initialStack?: Array<ExNavigationRoute>,
  navigation: ExNavigationContext,
  navigationState?: Object,
  navigatorUID: string,
  onRegisterNavigatorContext: (
    navigatorUID: string,
    navigatorContext: ExNavigationStackContext
  ) => void,
  onUnregisterNavigatorContext: (navigatorUID: string) => void,
  onTransitionStart: ?TransitionFn,
  onTransitionEnd: ?TransitionFn,
  renderScene?: (
    props: StackNavigationSceneRendererProps
  ) => ?React.Element<{}>,
};

type State = {
  id: string,
  navigatorUID: string,
  parentNavigatorUID: string,
  navigatingFromIndex: number,
  navigatingToIndex: number,
};

type Context = {
  headerComponent: mixed,
  alertBarComponent: mixed,
  parentNavigatorUID: string,
};

type ExNavigationSceneRendererProps = {
  route: ExNavigationRoute,
} & NavigationSceneRendererProps;

type StackNavigationSceneRendererProps = ExNavigationSceneRendererProps & {
  style?: any,
};

type TransitionOptions = {
  transitionGroup?: string,
};

let ROUTE_LISTENER_INDEX = 0;

type ExNavigationStackInstance = React.Component<*, *, *> & {
  _useAnimation: boolean,
  _routeListeners: { [listenerId: string]: Function },
};

declare var requestAnimationFrame: () => void;

export class ExNavigationStackContext extends ExNavigatorContext {
  type = 'stack';

  parentNavigatorUID: string;
  defaultRouteConfig: ExNavigationConfig;
  componentInstance: ExNavigationStackInstance;
  _getNavigatorState: any;

  constructor(
    navigatorUID: string,
    parentNavigatorUID: string,
    navigatorId: string,
    navigationContext: ExNavigationContext,
    componentInstance: ExNavigationStackInstance
  ) {
    super(navigatorUID, parentNavigatorUID, navigatorId, navigationContext);
    this.navigatorUID = navigatorUID;
    this.parentNavigatorUID = parentNavigatorUID;
    this.navigatorId = navigatorId;
    this.navigationContext = navigationContext;
    this.componentInstance = componentInstance;
  }

  get router(): ExNavigationRouter<*> {
    return this.navigationContext.router;
  }

  @debounce(500, true)
  push(
    route: ExNavigationRoute | string,
    paramsOrOptions?: Object | TransitionOptions,
    options?: TransitionOptions
  ) {
    if (typeof route == 'string') {
      route = this.router.getRoute(route, paramsOrOptions);
    } else {
      options = paramsOrOptions;
    }
    options = options || {};

    invariant(route !== null && route.key, 'Route is null or malformed.');

    if (options.transitionGroup) {
      route.config.styles = SharedElementGroup.getRouteStyle(
        options.transitionGroup
      );
    }

    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).push(route);
    });
  }

  @debounce(500, true)
  pop(n: number = 1) {
    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).pop(n);
    });
  }

  @debounce(500, true)
  popToTop() {
    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).popToTop();
    });
  }

  @debounce(500, true)
  replace(route: ExNavigationRoute | string, params?: Object) {
    if (typeof route == 'string') {
      route = this.router.getRoute(route, params);
    }

    invariant(route !== null && route.key, 'Route is null or malformed.');

    this.componentInstance._useAnimation = false;
    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).replace(route);
    });
    requestAnimationFrame(() => {
      this.componentInstance._useAnimation = true;
    });
  }

  getCurrentRoute() {
    const navigatorState = this._getNavigatorState();
    if (!navigatorState) {
      throw new Error('Navigation state for this navigator does not exist.');
    }
    return navigatorState.routes[navigatorState.index];
  }

  getCurrentIndex() {
    const navigatorState = this._getNavigatorState();
    if (!navigatorState) {
      throw new Error('Navigation state for this navigator does not exist.');
    }
    return navigatorState.index;
  }

  addRouteListener(listener: Function) {
    let listenerId = String(ROUTE_LISTENER_INDEX++);
    this.componentInstance._routeListeners[listenerId] = listener;
    return {
      remove: () => {
        delete this.componentInstance._routeListeners[listenerId];
      },
    };
  }

  immediatelyResetStack(routes: Array<ExNavigationRoute>, index: number = 0) {
    this.componentInstance._useAnimation = false;

    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).immediatelyResetStack(routes, index);
    });

    requestAnimationFrame(() => {
      this.componentInstance._useAnimation = true;
    });
  }

  showLocalAlert = (message: string, options: mixed) => {
    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).showLocalAlert(message, options);
    });
  };

  hideLocalAlert = () => {
    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).hideLocalAlert();
    });
  };

  updateCurrentRouteParams(newParams: Object) {
    this.navigationContext.performAction(({ stacks }) => {
      stacks(this.navigatorUID).updateCurrentRouteParams(newParams);
    });
  }
}

class ExNavigationStack extends PureComponent<any, Props, State> {
  props: Props;
  state: State;
  context: Context;
  _log: Function;
  _routeListeners: {
    [key: string]: Function,
  };
  _useAnimation: boolean;

  static route: ExNavigationConfig = {
    __isNavigator: true,
  };

  static defaultProps = {
    defaultRouteConfig: DEFAULT_ROUTE_CONFIG,
    onTransitionEnd: () => {},
    onTransitionStart: () => {},
  };

  static contextTypes = {
    parentNavigatorUID: PropTypes.string,
    headerComponent: PropTypes.func,
    alertBarComponent: PropTypes.func,
  };

  static childContextTypes = {
    parentNavigatorUID: PropTypes.string,
    navigator: PropTypes.instanceOf(ExNavigationStackContext),
    headerComponent: PropTypes.func,
    alertBarComponent: PropTypes.func,
  };

  getChildContext() {
    return {
      // Get the navigator actions instance for this navigator
      navigator: this._getNavigatorContext(),
      parentNavigatorUID: this.state.navigatorUID,
      headerComponent: this.props.headerComponent ||
        this.context.headerComponent,
      alertBarComponent: this.props.alertBarComponent ||
        this.context.alertBarComponent,
    };
  }

  constructor(props: Props, context: Context) {
    super(props, context);

    this.state = {
      id: props.id,
      navigatorUID: props.navigatorUID,
      parentNavigatorUID: context.parentNavigatorUID,
      navigatingFromIndex: -1,
      navigatingToIndex: 0,
    };

    this._routeListeners = {};
    this._useAnimation = true;
  }

  render() {
    const navigationState: ?Object = this.props.navigationState;

    if (!navigationState) {
      return null;
    }

    return (
      <NavigationTransitioner
        style={styles.container}
        navigationState={navigationState}
        render={this._renderTransitioner}
        configureTransition={this._configureTransition}
        onTransitionStart={this._onTransitionStart}
        onTransitionEnd={this._onTransitionEnd}
      />
    );
  }

  componentWillMount() {
    this._registerNavigatorContext();

    const { initialStack } = this.props;
    let { initialRoute } = this.props;

    invariant(
      initialRoute || initialStack,
      `You must specify initialRoute or initialStack to initialize this StackNavigation.`
    );

    invariant(
      (initialRoute && !initialStack) || (!initialRoute && initialStack),
      `Only specify one of 'initialRoute' or 'initialStack' when initializing StackNavigation.`
    );

    let routes: Array<ExNavigationRoute> = [];
    if (initialStack) {
      routes = initialStack;
    } else if (initialRoute) {
      // initialRoute can be passed in as strings
      if (typeof initialRoute === 'string') {
        initialRoute = this._getNavigatorContext().router.getRoute(
          initialRoute,
          {}
        );
      }
      routes = [initialRoute];
    }

    let stack = routes;

    if (this.props.navigationState) {
      stack = [...routes, ...this.props.navigationState.routes];
    }

    this.props.navigation.dispatch(
      Actions.setCurrentNavigator(
        this.state.navigatorUID,
        this.state.parentNavigatorUID,
        'stack',
        this._getDefaultRouteConfig(),
        stack,
        stack.length - 1
      )
    );

    if (this.state.parentNavigatorUID) {
      const parentNavigator = this.props.navigation.getNavigatorByUID(
        this.state.parentNavigatorUID
      );
      if (parentNavigator.type === 'tab') {
        ((parentNavigator: any): ExNavigationTabContext).setNavigatorUIDForCurrentTab(
          this.state.navigatorUID
        );
      } else if (parentNavigator.type === 'drawer') {
        ((parentNavigator: any): ExNavigationDrawerContext).setNavigatorUIDForCurrentItem(
          this.state.navigatorUID
        );
      }
    }

    getBackButtonManager().ensureGlobalListener();
  }

  componentWillUnmount() {
    this.props.navigation.dispatch(
      Actions.removeNavigator(this.state.navigatorUID)
    );
    this.props.onUnregisterNavigatorContext(this.state.navigatorUID);
  }

  componentWillReceiveProps(nextProps: Props) {
    const prevNavigationState: ?Object = this.props.navigationState;
    const nextNavigationState: ?Object = nextProps.navigationState;
    if (
      prevNavigationState &&
      nextNavigationState &&
      prevNavigationState.index !== nextNavigationState.index
    ) {
      _.forEach(this._routeListeners, listener => {
        listener(prevNavigationState, nextNavigationState);
      });

      this.setState({
        navigatingFromIndex: prevNavigationState.index,
        navigatingToIndex: nextNavigationState.index,
      });
    }
  }

  _configureTransition = (transitionProps, prevTransitionProps) => {
    if (!this._useAnimation) {
      return {
        duration: 0,
      };
    }

    // Gross...should figure out a way to make this stuff better TODO @skevy
    // In general though, we're getting route config (and thus, animation config) from the latest
    // scene, so that we know how to apply the animation.
    const navigationState: ?Object = this.props.navigationState;
    if (!navigationState) {
      return null;
    }

    const latestRoute =
      transitionProps.scenes[transitionProps.scenes.length - 1].route;
    const latestRouteConfig = latestRoute.config;
    const { configureTransition } = latestRouteConfig.styles || {};

    if (typeof configureTransition === 'function') {
      return configureTransition(transitionProps, prevTransitionProps);
    }
  };

  _registerNavigatorContext() {
    this.props.onRegisterNavigatorContext(
      this.state.navigatorUID,
      new ExNavigationStackContext(
        this.state.navigatorUID,
        this.state.parentNavigatorUID,
        this.state.id,
        this.props.navigation,
        this
      )
    );
  }

  _onNavigateBack = () => {
    this._getNavigatorContext().pop();
  };

  _renderTransitioner = props => {
    const header = this._renderHeader({
      ...props,
      scene: props.scene,
    });

    const alertBar = this._renderAlertBar({
      ...props,
      scene: props.scene,
    });

    const scenes = props.scenes.map(scene =>
      this._renderScene({
        ...props,
        scene,
      })
    );

    return (
      <View style={styles.container}>
        <View style={styles.scenes}>
          {scenes}
        </View>
        {header}
        {alertBar}
      </View>
    );
  };

  _getNavigationBarHeight(latestRouteConfig) {
    let height = NavigationBar.DEFAULT_HEIGHT;

    if (
      latestRouteConfig.navigationBar && latestRouteConfig.navigationBar.height
    ) {
      height =
        latestRouteConfig.navigationBar.height + DEFAULT_STATUSBAR_HEIGHT;
    }

    if (
      latestRouteConfig.statusBar && latestRouteConfig.statusBar.translucent
    ) {
      height =
        NavigationBar.DEFAULT_HEIGHT_WITHOUT_STATUS_BAR +
        DEFAULT_STATUSBAR_HEIGHT;
    }

    return height;
  }

  _renderAlertBar = (props: ExNavigationSceneRendererProps) => {
    const latestRoute = this._getRouteAtIndex(
      props.scenes,
      props.scenes.length - 1
    );
    const latestRouteConfig: ExNavigationConfig = latestRoute.config;
    const navigationBarIsVisible =
      latestRouteConfig.navigationBar &&
      latestRouteConfig.navigationBar.visible !== false;

    const AlertBarComponent =
      this.props.alertBarComponent ||
      this.context.alertBarComponent ||
      ExNavigationAlertBar;

    const alertBarContainerStyle = [
      styles.alertBarContainer,
      {
        top: navigationBarIsVisible
          ? this._getNavigationBarHeight(latestRouteConfig)
          : 0,
      },
    ];

    return (
      <View style={alertBarContainerStyle}>
        <AlertBarComponent
          style={
            navigationBarIsVisible ? null : { paddingTop: STATUSBAR_HEIGHT + IPHONE_X_EXTRA_HEIGHT }
          }
          getNavigatorContext={this._getNavigatorContext}
          navigatorUID={this.state.navigatorUID}
        />
      </View>
    );
  };

  _renderHeader = (props: ExNavigationSceneRendererProps) => {
    // Determine animation styles based on the most recent scene in the stack.
    const latestRoute = this._getRouteAtIndex(
      props.scenes,
      props.scenes.length - 1
    );
    const latestRouteConfig: ExNavigationConfig = latestRoute.config;

    props = { ...props, latestRouteConfig, latestRoute };

    if (typeof this.props.renderOverlay === 'function') {
      return this.props.renderOverlay(props);
    }

    let interpolator = null;
    if (latestRouteConfig.styles) {
      interpolator = latestRouteConfig.styles.navigationBarAnimations;
      if (
        latestRouteConfig.navigationBar &&
        latestRouteConfig.navigationBar.styles
      ) {
        interpolator = latestRouteConfig.navigationBar.styles;
      }
    }

    // Get HeaderComponent from props/context
    const HeaderComponent =
      this.props.headerComponent ||
      this.context.headerComponent ||
      NavigationBar;
    const navigationBarIsVisible =
      latestRouteConfig.navigationBar &&
      latestRouteConfig.navigationBar.visible !== false;

    // pass the statusBarHeight to headerComponent if statusBar is translucent
    let statusBarHeight = STATUSBAR_HEIGHT;
    if (
      latestRouteConfig.statusBar && latestRouteConfig.statusBar.translucent
    ) {
      statusBarHeight = DEFAULT_STATUSBAR_HEIGHT;
    }

    // TODO: add height here
    return (
      <HeaderComponent
        {...props}
        statusBarHeight={statusBarHeight}
        getNavigatorContext={this._getNavigatorContext}
        navigatorUID={this.state.navigatorUID}
        visible={navigationBarIsVisible}
        interpolator={interpolator}
        renderLeftComponent={this._renderLeftComponentForHeader}
        renderTitleComponent={this._renderTitleComponentForHeader}
        renderRightComponent={this._renderRightComponentForHeader}
        renderBackgroundComponent={this._renderBackgroundComponentForHeader}
      />
    );
  };

  _drawerNavigatorParent = () => {
    let result;
    let currentNavigator = this._getNavigatorContext();

    while (currentNavigator) {
      try {
        currentNavigator = currentNavigator.getParentNavigator();
      } catch (e) {
        break;
      }

      if (currentNavigator && currentNavigator.type === 'drawer') {
        result = currentNavigator;
        break;
      }
    }

    return result;
  };

  _renderBackgroundComponentForHeader = props => {
    //eslint-disable-line react/display-name
    const { scene: { route } } = props;
    const routeConfig = route.config;

    if (
      routeConfig.navigationBar &&
      typeof routeConfig.navigationBar.renderBackground === 'function'
    ) {
      let maybeBackgroundComponent = routeConfig.navigationBar.renderBackground(
        route,
        props
      );

      if (maybeBackgroundComponent) {
        return maybeBackgroundComponent;
      }

      return null;
    }
  };

  _renderLeftComponentForHeader = props => {
    //eslint-disable-line react/display-name
    const { scene: { route } } = props;
    const routeConfig = route.config;

    if (
      routeConfig.navigationBar &&
      typeof routeConfig.navigationBar.renderLeft === 'function'
    ) {
      let maybeLeftComponent = routeConfig.navigationBar.renderLeft(
        route,
        props
      );

      if (maybeLeftComponent) {
        return maybeLeftComponent;
      }

      return null;
    }

    let menuButton = this._maybeRenderMenuButton('left', route, props);
    if (menuButton) {
      return menuButton;
    }

    if (props.scene.index > 0) {
      return <NavigationBar.BackButton tintColor={route.getBarTintColor()} />;
    }

    return null;
  };

  _maybeRenderMenuButton = (position, route, props) => {
    const drawerNavigatorParent = this._drawerNavigatorParent();

    if (props.scene.index === 0 && !!drawerNavigatorParent) {
      // Don't render the button on the left if the drawerPosition is on the
      // right, and vice versa
      if (drawerNavigatorParent.options.drawerPosition !== position) {
        return;
      }

      return (
        <NavigationBar.MenuButton
          navigator={drawerNavigatorParent}
          tintColor={route.getBarTintColor()}
        />
      );
    }
  };

  _renderTitleComponentForHeader = props => {
    //eslint-disable-line react/display-name
    const { scene: { route } } = props;
    const routeConfig = route.config;
    if (
      routeConfig.navigationBar &&
      typeof routeConfig.navigationBar.renderTitle === 'function'
    ) {
      return routeConfig.navigationBar.renderTitle(route, props);
    }
    return (
      <NavigationBar.Title
        textStyle={route.getTitleStyle()}
        tintColor={route.getBarTintColor()}>
        {route.getTitle()}
      </NavigationBar.Title>
    );
  };

  _renderRightComponentForHeader = props => {
    const { scene: { route } } = props;
    const routeConfig = route.config;

    if (
      routeConfig.navigationBar &&
      typeof routeConfig.navigationBar.renderRight === 'function'
    ) {
      let maybeRightComponent = routeConfig.navigationBar.renderRight(
        route,
        props
      );

      if (maybeRightComponent) {
        return maybeRightComponent;
      }

      return null;
    }

    let menuButton = this._maybeRenderMenuButton('right', route, props);
    if (menuButton) {
      return menuButton;
    }

    return null;
  };

  _renderScene = (props: ExNavigationSceneRendererProps) => {
    // Determine gesture and animation styles based on the most recent scene in the stack,
    // not based on the scene we're rendering in this method.
    const latestRoute = this._getRouteAtIndex(
      props.scenes,
      props.scenes.length - 1
    );

    const latestRouteConfig = latestRoute.config;
    const { sceneAnimations, gestures } = latestRouteConfig.styles || {};

    const scene: any = props.scene;
    const routeForScene = scene.route;

    props = {
      ...props,
      latestRouteConfig,
      latestRoute,
      onNavigateBack: this._onNavigateBack,
      key: props.scene.key,
      route: routeForScene,
      sceneAnimations,
      gestures,
      renderScene: this._renderRoute,
    };

    if (typeof this.props.renderScene === 'function') {
      return this.props.renderScene(props);
    }

    return <NavigationItem {...props} />;
  };

  _renderRoute = (props: ExNavigationSceneRendererProps) => {
    const route: ExNavigationRoute = props.route;
    let routeElement = route.render();
    if (this.props.augmentScene) {
      routeElement = this.props.augmentScene(routeElement, route);
    }

    let routeElementProps = {};

    const routeConfig = route.config;

    routeElementProps = {
      route,
    };

    let style = [styles.routeInnerContainer];

    if (
      routeConfig.navigationBar && routeConfig.navigationBar.visible !== false
    ) {
      let customHeight = 0;
      let hasCustomHeight = false;
      let isTranslucent = !!routeConfig.navigationBar.translucent;

      if (_.isNumber(route.getBarHeight())) {
        customHeight += route.getBarHeight();
        hasCustomHeight = true;
      }

      if (hasCustomHeight) {
        style = ([...style, { marginTop: customHeight }]: Array<
          number | Object
        >);
      } else {
        style = [
          ...style,
          isTranslucent
            ? styles.withNavigationBarTranslucent
            : { paddingTop: this._getNavigationBarHeight(routeConfig) },
        ];
      }
    } else {
      style = [...style, styles.withoutNavigationBar];
    }

    if (routeConfig.sceneStyle) {
      style = [...style, routeConfig.sceneStyle || styles.defaultSceneStyle];
    }

    return (
      <View style={styles.routeContainer}>
        <Animated.View style={style}>
          <View style={{ flex: 1 }}>
            {cloneReferencedElement(routeElement, routeElementProps)}
          </View>
        </Animated.View>
      </View>
    );
  };

  _onTransitionStart = (transitionProps, prevTransitionProps) => {
    const { route: nextRoute } = transitionProps.scene;

    const nextRouteConfig = nextRoute.config;
    if (nextRouteConfig.styles && nextRouteConfig.styles.onTransitionStart) {
      nextRouteConfig.styles.onTransitionStart(
        transitionProps,
        prevTransitionProps
      );
    }

    if (prevTransitionProps) {
      const { route: prevRoute } = prevTransitionProps.scene;
      const prevRouteConfg = prevRoute.config;
      if (prevRouteConfg.styles && prevRouteConfg.styles.onTransitionStart) {
        prevRouteConfg.styles.onTransitionStart(
          transitionProps,
          prevTransitionProps
        );
      }
    }

    if (this.props.onTransitionStart) {
      this.props.onTransitionStart(transitionProps, prevTransitionProps);
    }
  };

  _onTransitionEnd = (transitionProps, prevTransitionProps) => {
    const { route: nextRoute } = transitionProps.scene;

    const nextRouteConfig = nextRoute.config;
    if (nextRouteConfig.styles && nextRouteConfig.styles.onTransitionEnd) {
      nextRouteConfig.styles.onTransitionEnd(
        transitionProps,
        prevTransitionProps
      );
    }

    if (prevTransitionProps) {
      const { route: prevRoute } = prevTransitionProps.scene;
      const prevRouteConfg = prevRoute.config;
      if (prevRouteConfg.styles && prevRouteConfg.styles.onTransitionEnd) {
        prevRouteConfg.styles.onTransitionEnd(
          transitionProps,
          prevTransitionProps
        );
      }
    }

    if (this.props.onTransitionEnd) {
      this.props.onTransitionEnd(transitionProps, prevTransitionProps);
    }
  };

  _getRouteAtIndex(
    scenes: Array<NavigationScene>,
    index: number
  ): ExNavigationRoute {
    const scene: any = scenes[index];
    const latestRoute: ExNavigationRoute = scene.route;
    return latestRoute;
  }

  _getDefaultRouteConfig(props) {
    if (!props) {
      props = this.props;
    }
    return _.merge({}, DEFAULT_ROUTE_CONFIG, props.defaultRouteConfig);
  }

  // TODO: fix this type annotation to return the actual type
  _getNavigatorContext = (): any => {
    return this.props.navigation.getNavigatorByUID(this.state.navigatorUID);
  };
}

export default createNavigatorComponent(ExNavigationStack);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scenes: {
    flex: 1,
  },
  defaultSceneStyle: {
    backgroundColor: '#fff',
  },
  routeContainer: {
    flex: 1,
  },
  routeInnerContainer: {
    flex: 1,
  },
  withoutNavigationBar: {
    marginTop: 0,
  },
  withNavigationBarTranslucent: {
    paddingTop: 0,
  },
  alertBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
