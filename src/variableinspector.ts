import {
    ISignal
} from '@phosphor/signaling';

import {
    Token
} from '@phosphor/coreutils';

import {
     DockLayout,  Widget, Panel
} from '@phosphor/widgets';

import {
    DataGrid, DataModel
} from "@phosphor/datagrid";

import {
    MainAreaWidget
} from "@jupyterlab/apputils";

import '../style/index.css';

const PANEL_CLASS = "jp-VarInspector";
const TABLE_CLASS = "jp-VarInspector-table";
const TABLE_BODY_CLASS = "jp-VarInspector-content";
const TOOLBAR_BUTTON_CLASS = "jp-Toolbar-kernelName";

/**
 * The inspector panel token.
 */
export
    const IVariableInspector = new Token<IVariableInspector>( "jupyterlab_extension/variableinspector:IVariableInspector" );

/**
 * An interface for an inspector.
 */
export
    interface IVariableInspector {
    source: IVariableInspector.IInspectable | null;

}

/**
 * A namespace for inspector interfaces.
 */
export
namespace IVariableInspector {

    export
        interface IInspectable {
        disposed: ISignal<any, void>;
        inspected: ISignal<any, IVariableInspectorUpdate>;
        performInspection(): void;
        performMatrixInspection( varName: string, maxRows? : number ): Promise<DataModel>;
    }

    export
        interface IVariableInspectorUpdate {
        info: IVariableKernelInfo;
        payload: Array<IVariable>;
    } 
    
    export
        interface IVariableKernelInfo {
        kernelName?: string;
        languageName?: string;
        context?: string; //Context currently reserved for special information.
    }

    export
        interface IVariable {
        varName: string;
        varSize: string;
        varShape: string;
        varContent: string;
        varType: string;
        isMatrix: boolean;
    }  
}


/**
 * A panel that renders the variables
 */
export
    class VariableInspectorPanel extends MainAreaWidget<Widget> implements IVariableInspector {

    private _source: IVariableInspector.IInspectable | null = null;
    private _table: HTMLTableElement;
    private _kernelInfoWidget : Private.ToolbarKernelInfo;

    constructor() {
        super({content : new Panel()});
        this.content.addClass( PANEL_CLASS );        
        this._table = Private.createTable();
        this._table.className = TABLE_CLASS;
        this.content.node.appendChild( this._table as HTMLElement );
        this._kernelInfoWidget = new Private.ToolbarKernelInfo();
        this.toolbar.addItem(name, this._kernelInfoWidget);
    }

    get source(): IVariableInspector.IInspectable | null {
        return this._source;
    }

    set source( source: IVariableInspector.IInspectable | null ) {

        if ( this._source === source ) {
           // this._source.performInspection();
            return;
        }
        //Remove old subscriptions
        if ( this._source ) {
            this._source.inspected.disconnect( this.onInspectorUpdate, this );
            this._source.disposed.disconnect( this.onSourceDisposed, this );
        }
        this._source = source;
        //Subscribe to new object
        if ( this._source ) {
            this._source.inspected.connect( this.onInspectorUpdate, this );
            this._source.disposed.connect( this.onSourceDisposed, this );
            this._source.performInspection();
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if ( this.isDisposed ) {
            return;
        }
        this.source = null;
        super.dispose();
    }

    protected onInspectorUpdate( sender: any, allArgs: IVariableInspector.IVariableInspectorUpdate): void {

        let kernelInfo = allArgs.info;
        let args = allArgs.payload;


        this._kernelInfoWidget.content = kernelInfo;
       

        //Render new variable state
        let row: HTMLTableRowElement;
        this._table.deleteTFoot();
        this._table.createTFoot();
        this._table.tFoot.className = TABLE_BODY_CLASS;
        for ( var index = 0; index < args.length; index++ ) {
            row = this._table.tFoot.insertRow();
            if ( args[index].isMatrix ) {
                let name = args[index].varName;
                row.onclick = ( ev: MouseEvent ): any => {
                    this._source.performMatrixInspection( name ).then(( model: DataModel ) => {
                        this._showMatrix( model, name )
                    } );
                }
            }
            let cell = row.insertCell( 0 );
            cell.innerHTML = args[index].varName;
            cell = row.insertCell( 1 );
            cell.innerHTML = args[index].varType;
            cell = row.insertCell( 2 );
            cell.innerHTML = args[index].varSize;
            cell = row.insertCell( 3 );
            cell.innerHTML = args[index].varShape;
            cell = row.insertCell( 4 );
            cell.innerHTML = args[index].varContent.replace(/\\n/g,  "</br>");
        }
    }

    /**
     * Handle source disposed signals.
     */
    protected onSourceDisposed( sender: any, args: void ): void {
        this.source = null;
    }



    private _showMatrix( dataModel: DataModel, name: string ): void {
        let datagrid = new DataGrid( {
            baseRowSize: 32,
            baseColumnSize: 128,
            baseRowHeaderSize: 64,
            baseColumnHeaderSize: 32
        } );
        datagrid.model = dataModel;
        datagrid.title.label = "Matrix: " + name;
        datagrid.title.closable = true;
        let lout: DockLayout = <DockLayout>this.parent.layout;
        lout.addWidget( datagrid , {mode: "split-right"});
        //todo activate/focus matrix widget
    }
    
}

namespace Private {

    export
        function createTable(): HTMLTableElement {
            const table = document.createElement( "table" );
            table.createTHead();
            const hrow = <HTMLTableRowElement>table.tHead.insertRow( 0 );
            const cell1 = hrow.insertCell( 0 );
            cell1.innerHTML = "Name";
            const cell2 = hrow.insertCell( 1 );
            cell2.innerHTML = "Type";
            const cell3 = hrow.insertCell( 2 );
            cell3.innerHTML = "Size";
            const cell4 = hrow.insertCell( 3 );
            cell4.innerHTML = "Shape";
            const cell5 = hrow.insertCell( 4 );
            cell5.innerHTML = "Content";
            return table;
    }  
    
    export class ToolbarKernelInfo extends Widget{        
        constructor() {
            super();
            this.addClass(TOOLBAR_BUTTON_CLASS);
            this.node.textContent = "Loading...";
         }
        
        set content(info : IVariableInspector.IVariableKernelInfo){
            
            if (info.context){
                this.node.innerHTML = info.context;
            }else{
                this.node.innerHTML = "Inspecting " + info.languageName + "-kernel '" + info.kernelName;
            }            
        }
    }    
}