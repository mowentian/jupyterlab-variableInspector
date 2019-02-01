import {
  IVariableInspector,
  VariableInspectorPanel
} from './variableinspector';

import { KernelConnector } from './kernelconnector';

import { VariableInspectionHandler, DummyHandler } from './handler';

import { VariableInspectorManager, IVariableInspectorManager } from './manager';

import { Languages } from './inspectorscripts';

import { ICommandPalette, InstanceTracker } from '@jupyterlab/apputils';

import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  JupyterLab
} from '@jupyterlab/application';

import { IConsoleTracker } from '@jupyterlab/console';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';

namespace CommandIDs {
  export const open = 'variableinspector:open';
}

/**
 * A service providing variable introspection.
 */
const variableinspector: JupyterFrontEndPlugin<IVariableInspectorManager> = {
  id: 'jupyterlab-extension:variableinspector',
  requires: [ICommandPalette, ILayoutRestorer],
  provides: IVariableInspectorManager,
  autoStart: true,
  activate: (
    app: JupyterLab,
    palette: ICommandPalette,
    restorer: ILayoutRestorer
  ): IVariableInspectorManager => {
    const manager = new VariableInspectorManager();
    const category = 'Variable Inspector';
    const command = CommandIDs.open;
    const label = 'Open Variable Inspector';
    const namespace = 'variableinspector';
    const tracker = new InstanceTracker<VariableInspectorPanel>({ namespace });

    /**
     * Create and track a new inspector.
     */
    function newPanel(): VariableInspectorPanel {
      const panel = new VariableInspectorPanel();

      panel.id = 'jp-variableinspector';
      panel.title.label = 'Variable Inspector';
      panel.title.closable = true;
      panel.disposed.connect(() => {
        if (manager.panel === panel) {
          manager.panel = null;
        }
      });

      // Track the inspector panel
      tracker.add(panel);

      return panel;
    }

    // Enable state restoration
    restorer.restore(tracker, {
      command,
      args: () => null,
      name: () => 'variableinspector'
    });

    // Add command to palette
    app.commands.addCommand(command, {
      label,
      execute: () => {
        if (!manager.panel || manager.panel.isDisposed) {
          manager.panel = newPanel();
        }
        if (!manager.panel.isAttached) {
          app.shell.add(manager.panel, 'main');
        }
        if (manager.source) {
          manager.source.performInspection();
        }
        app.shell.activateById(manager.panel.id);
      }
    });
    palette.addItem({ command, category });
    return manager;
  }
};

/**
 * An extension that registers consoles for variable inspection.
 */
const consoles: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-extension:variableinspector:consoles',
  requires: [IVariableInspectorManager, IConsoleTracker],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    manager: IVariableInspectorManager,
    consoles: IConsoleTracker
  ): void => {
    if (!(app instanceof JupyterLab)) {
      throw new Error(`must be activated in JupyterLab.`);
    }

    const handlers: {
      [id: string]: Promise<IVariableInspector.IInspectable>;
    } = {};

    /**
     * Subscribes to the creation of new consoles. If a new notebook is created, build a new handler for the consoles.
     * Adds a promise for a instanced handler to the 'handlers' collection.
     */
    consoles.widgetAdded.connect((sender, consolePanel) => {
      if (manager.hasHandler(consolePanel.session.path)) {
        handlers[consolePanel.id] = new Promise(function(resolve, reject) {
          resolve(manager.getHandler(consolePanel.session.path));
        });
      } else {
        handlers[consolePanel.id] = new Promise(function(resolve, reject) {
          const session = consolePanel.session;
          const connector = new KernelConnector({ session });

          connector.ready.then(() => {
            // Create connector and init w script if it exists for kernel type.
            let kerneltype: string = connector.kerneltype;
            let scripts: Promise<Languages.LanguageModel> = Languages.getScript(
              kerneltype
            );

            scripts.then((result: Languages.LanguageModel) => {
              let initScript = result.initScript;
              let queryCommand = result.queryCommand;
              let matrixQueryCommand = result.matrixQueryCommand;

              const options: VariableInspectionHandler.IOptions = {
                queryCommand: queryCommand,
                matrixQueryCommand: matrixQueryCommand,
                connector: connector,
                initScript: initScript,
                id: session.path // Using the sessions path as an identifier for now.
              };
              const handler = new VariableInspectionHandler(options);
              manager.addHandler(handler);
              consolePanel.disposed.connect(() => {
                delete handlers[consolePanel.id];
                handler.dispose();
              });

              handler.ready.then(() => {
                resolve(handler);
              });
            });

            // Otherwise log error message.
            scripts.catch((result: string) => {
              console.log(result);
              const handler = new DummyHandler(connector);
              consolePanel.disposed.connect(() => {
                delete handlers[consolePanel.id];
                handler.dispose();
              });
              resolve(handler);
            });
          });
        });
      }
    });

    /**
     * If focus window changes, checks whether new focus widget is a console.
     * In that case, retrieves the handler associated to the console after it has been
     * initialized and updates the manager with it.
     */
    app.shell.currentChanged.connect((sender, args) => {
      let widget = args.newValue;
      if (!widget || !consoles.has(widget)) {
        return;
      }
      let future = handlers[widget.id];
      future.then((source: IVariableInspector.IInspectable) => {
        if (source) {
          manager.source = source;
          manager.source.performInspection();
        }
      });
    });

    app.contextMenu.addItem({
      command: CommandIDs.open,
      selector: '.jp-CodeConsole'
    });
  }
};

/**
 * An extension that registers notebooks for variable inspection.
 */
const notebooks: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-extension:variableinspector:notebooks',
  requires: [IVariableInspectorManager, INotebookTracker],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    manager: IVariableInspectorManager,
    notebooks: INotebookTracker
  ): void => {
    if (!(app instanceof JupyterLab)) {
      throw new Error(`must be activated in JupyterLab.`);
    }
    const handlers: { [id: string]: Promise<VariableInspectionHandler> } = {};

    /**
     * Subscribes to the creation of new notebooks. If a new notebook is created, build a new handler for the notebook.
     * Adds a promise for a instanced handler to the 'handlers' collection.
     */
    notebooks.widgetAdded.connect((sender, nbPanel: NotebookPanel) => {
      // A promise that resolves after the initialization of the handler is done.
      handlers[nbPanel.id] = new Promise(function(resolve, reject) {
        const session = nbPanel.session;
        const connector = new KernelConnector({ session });

        connector.ready.then(() => {
          // Create connector and init w script if it exists for kernel type.
          let kerneltype: string = connector.kerneltype;
          let scripts: Promise<Languages.LanguageModel> = Languages.getScript(
            kerneltype
          );

          scripts.then((result: Languages.LanguageModel) => {
            let initScript = result.initScript;
            let queryCommand = result.queryCommand;
            let matrixQueryCommand = result.matrixQueryCommand;

            const options: VariableInspectionHandler.IOptions = {
              queryCommand: queryCommand,
              matrixQueryCommand: matrixQueryCommand,
              connector: connector,
              initScript: initScript,
              id: session.path // Using the sessions path as an identifier for now.
            };
            const handler = new VariableInspectionHandler(options);
            manager.addHandler(handler);
            nbPanel.disposed.connect(() => {
              delete handlers[nbPanel.id];
              handler.dispose();
            });

            handler.ready.then(() => {
              resolve(handler);
            });
          });

          // Otherwise log error message.
          scripts.catch((result: string) => {
            reject(result);
          });
        });
      });
    });

    /**
     * If focus window changes, checks whether new focus widget is a notebook.
     * In that case, retrieves the handler associated to the notebook after it has been
     * initialized and updates the manager with it.
     */
    app.shell.currentChanged.connect((sender, args) => {
      let widget = args.newValue;
      if (!widget || !notebooks.has(widget)) {
        return;
      }
      let future = handlers[widget.id];
      future.then((source: VariableInspectionHandler) => {
        if (source) {
          manager.source = source;
          manager.source.performInspection();
        }
      });
    });

    app.contextMenu.addItem({
      command: CommandIDs.open,
      selector: '.jp-Notebook'
    });
  }
};

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  variableinspector,
  consoles,
  notebooks
];
export default plugins;
