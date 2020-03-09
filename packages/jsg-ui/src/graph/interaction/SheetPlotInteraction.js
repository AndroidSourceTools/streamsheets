import { Term, NullTerm } from '@cedalo/parser';
import {
	default as JSG,
	GraphUtils,
	StreamSheet,
	CompoundCommand,
	NumberExpression,
	Selection,
	DeleteCellContentCommand,
	SheetPlotNode,
	SetCellDataCommand, NotificationCenter, Notification, SetCellsCommand
} from '@cedalo/jsg-core';

import Interaction from './Interaction';
import ChartSelectionFeedbackView from '../feedback/ChartSelectionFeedbackView';
import ChartInfoFeedbackView from '../feedback/ChartInfoFeedbackView';
import Cursor from '../../ui/Cursor';
import SelectionProvider from '../view/SelectionProvider';
import WorksheetView from '../view/WorksheetView';
import SheetInteraction from './SheetInteraction';

export default class SheetPlotInteraction extends Interaction {
	constructor() {
		super();

		this._controller = undefined;
		this._feedback = undefined;
	}

	deactivate(viewer) {
		viewer.removeInteractionFeedback(this._feedback);

		this._feedback = undefined;

		super.deactivate(viewer);
	}

	onKeyDown(event, viewer, dispatcher) {
		const focus = viewer.getGraphView().getFocus();
		if (focus && focus.getView() instanceof WorksheetView && focus.getView().hasSelection()) {
			const interaction = this.activateInteraction(new SheetInteraction(), dispatcher);
			interaction._controller = focus;
			interaction._hitCode = WorksheetView.HitCode.SHEET;
			if (interaction.onKeyDown(event, viewer)) {
				event.isConsumed = true;
				event.hasActivated = true;
			}
		}
	}

	toLocalCoordinate(event, viewer, point) {
		viewer.translateFromParent(point);

		GraphUtils.traverseDown(viewer.getGraphView(), this._controller.getView(), (v) => {
			v.translateFromParent(point);
			return true;
		});

		return point;
	}

	isElementHit(event, viewer, oldSelection) {
		const pt = this.toLocalCoordinate(event, viewer, event.location.copy());

		return this._controller.getModel().isElementHit(pt, oldSelection);
	}

	isPlotHit(event, viewer) {
		const pt = this.toLocalCoordinate(event, viewer, event.location.copy());

		return this._controller.getModel().isPlotHit(pt);
	}

	showData(selection, event, viewer) {
		if (selection) {
			viewer.getGraphView().clearLayer('chartinfo');
			const layer = viewer.getGraphView().getLayer('chartinfo');

			const item = this._controller.getModel();
			let type = item.xAxes[0].type;
			// if (type === 'category') {
			// 	return;
			// }

			const children = this._controller.getParent().children;
			const pt = this.toLocalCoordinate(event, viewer, event.location.copy());
			const axes = item.getAxes();
			const value = item.scaleFromAxis(axes, pt);

			children.forEach((controller) => {
				if (controller.getModel() instanceof SheetPlotNode) {
					type = controller.getModel().xAxes[0].type;
					layer.push(
						new ChartInfoFeedbackView(controller.getView(), selection, event.location.copy(), value, viewer));
				}
			});
		}
	}

	onMouseDown(event, viewer) {
		if (this._controller === undefined) {
			return;
		}

		const selectionProvider = viewer.getSelectionProvider();
		if (!selectionProvider.hasSelection() || selectionProvider.getFirstSelection() !== this._controller) {
			viewer.clearSelection();
			viewer.select(this._controller);
		}

		const view = this._controller.getView();
		const selection = this.isElementHit(event, viewer, view.chartSelection);
		if (selection === undefined) {
			return;
		}

		if (!view.getItem().isProtected()) {
			view.chartSelection = selection;
			NotificationCenter.getInstance().send(new Notification(SelectionProvider.SELECTION_CHANGED_NOTIFICATION, view.getItem()));
			viewer.setCursor(Cursor.Style.AUTO);

			if (selection) {
				const layer = view.getGraphView().getLayer('chartselection');
				layer.push(new ChartSelectionFeedbackView(view));
			}
		}
	}

	onMouseDrag(event, viewer) {
		const graphView = viewer.getGraphView();

		graphView.clearLayer('chartselection');
		const layer = graphView.getLayer('chartinfo');
		if (layer === undefined || !layer.length) {
			return;
		}
		if (layer.length >= 1) {
			layer.forEach((view) => {
				if (view.chartView.getItem().getId() === this._controller.getView().getItem().getId()) {
					view.endPoint = event.location;
				}
			});
		}
		viewer.setCursor(Cursor.Style.CROSS);
	}

	onMouseDoubleClick(event, viewer) {
	}

	onMouseUp(event, viewer) {
		if (this._controller === undefined) {
			super.onMouseUp(event, viewer);
			return;
		}

		const graphView = viewer.getGraphView();
		const layer = graphView.getLayer('chartinfo');
		if (layer === undefined || !layer.length) {
			super.onMouseUp(event, viewer);
			return;
		}

		layer.forEach((view) => {
			if (view.endPoint) {
				const ptStart = this.toLocalCoordinate(event, viewer, view.point.copy());
				const ptEnd = this.toLocalCoordinate(event, viewer, view.endPoint.copy());
				if (Math.abs(ptEnd.x - ptStart.x) > 150) {
					const item = this._controller.getModel();
					const axes = item.getAxes();
					const valueStart = item.scaleFromAxis(axes, ptStart.x < ptEnd.x ? ptStart : ptEnd);
					const valueEnd = item.scaleFromAxis(axes, ptStart.x < ptEnd.x ? ptEnd : ptStart);

					this.setParamValues(viewer, item, item.xAxes[0].formula,
						[{index: 4, value: valueStart.x}, {index: 5, value: valueEnd.x}]);
					item.spreadZoomInfo();

					viewer.getGraph().markDirty();
					event.doRepaint = true;
				}
			}
		});

		super.onMouseUp(event, viewer);
	}

	setParamValues(viewer, item, expression, values) {
		const term = expression.getTerm();
		if (term === undefined) {
			return;
		}

		let selection;
		const cellData = [];
		let sheet;

		values.forEach((value) => {
			const info = item.getParamInfo(term, value.index);
			if (info) {
				sheet = info.sheet;
				const range = info.range.copy();
				if (value.value === undefined) {
					if (!selection) {
						selection = new Selection(info.sheet);
					}
					selection.add(range);
				} else {
					range.shiftToSheet();
					const cell = {};
					cell.reference = range.toString();
					cell.value = value.value;
					cellData.push(cell);
				}
			} else if (term && term.params) {
				for (let i = term.params.length; i < value.index; i += 1) {
					term.params[i] = new NullTerm();
				}

				if (value.value === undefined) {
					term.params[value.index] = new NullTerm();
				} else {
					term.params[value.index] = Term.fromNumber(value.value);
				}
				expression.correctFormula();
			}

		});

		if (sheet) {
			if (selection) {
				const cmd = new DeleteCellContentCommand(sheet, selection.toStringMulti(), "all");
				viewer.getInteractionHandler().execute(cmd);
			} else if (cellData.length) {
				const cmd = new SetCellsCommand(sheet, cellData, false);
				viewer.getInteractionHandler().execute(cmd);
			}
		}
	}

	willFinish(event, viewer) {
		super.willFinish(event, viewer);
	}

	cancelInteraction(event, viewer) {
		super.cancelInteraction(event, viewer);
	}

	getSheet() {
		let sheet = this._controller.getModel().getParent();
		while (sheet && !(sheet instanceof StreamSheet)) {
			sheet = sheet.getParent();
		}

		return sheet;
	}
}