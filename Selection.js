define([
	'dojo/_base/declare',
	'dojo/dom-class',
	'dojo/on',
	'dojo/has',
	'dojo/aspect',
	'./List',
	'dojo/has!touch?./util/touch',
	'./SelectionBase',
	'dojo/query',
	'dojo/_base/sniff',
	'dojo/dom' // for has('css-user-select') in 1.8.2+
], function (declare, domClass, on, has, aspect, List, touchUtil, SelectionBase) {

	return declare(SelectionBase, {

		_select: function (row, toRow, value) {
			var selection,
				previousValue,
				element,
				toElement,
				direction;

			if (typeof value === 'undefined') {
				// default to true
				value = true;
			}
			if (!row.element) {
				row = this.row(row);
			}

			// Check whether we're allowed to select the given row before proceeding.
			// If a deselect operation is being performed, this check is skipped,
			// to avoid errors when changing column definitions, and since disabled
			// rows shouldn't ever be selected anyway.
			if (value === false || this.allowSelect(row)) {
				selection = this.selection;
				previousValue = !!selection[row.id];
				if (value === null) {
					// indicates a toggle
					value = !previousValue;
				}
				element = row.element;
				if (!value && !this.allSelected) {
					delete this.selection[row.id];
				}
				else {
					selection[row.id] = value;
				}
				if (element) {
					// add or remove classes as appropriate
					if (value) {
						domClass.add(element, 'dgrid-selected' +
							(this.addUiClasses ? ' ui-state-active' : ''));
					}
					else {
						domClass.remove(element, 'dgrid-selected ui-state-active');
					}
				}
				if (value !== previousValue && element) {
					// add to the queue of row events
					this._selectionEventQueues[(value ? '' : 'de') + 'select'].push(row);
				}

				if (toRow) {
					if (!toRow.element) {
						toRow = this.row(toRow);
					}

					if (!toRow) {
						this._lastSelected = element;
						console.warn('The selection range has been reset because the ' +
							'beginning of the selection is no longer in the DOM. ' +
							'If you are using OnDemandList, you may wish to increase ' +
							'farOffRemoval to avoid this, but note that keeping more nodes ' +
							'in the DOM may impact performance.');
						return;
					}

					toElement = toRow.element;
					if (toElement) {
						direction = this._determineSelectionDirection(element, toElement);
						if (!direction) {
							// The original element was actually replaced
							toElement = document.getElementById(toElement.id);
							direction = this._determineSelectionDirection(element, toElement);
						}
						while (row.element !== toElement && (row = this[direction](row))) {
							this._select(row, null, value);
						}
					}
				}
			}
		},

		select: function (row, toRow, value) {
			// summary:
			//		Selects or deselects the given row or range of rows.
			// row: Mixed
			//		Row object (or something that can resolve to one) to (de)select
			// toRow: Mixed
			//		If specified, the inclusive range between row and toRow will
			//		be (de)selected
			// value: Boolean|Null
			//		Whether to select (true/default), deselect (false), or toggle
			//		(null) the row
			this._select(row, toRow, value);
			this._fireSelectionEvents();
		},
		deselect: function (row, toRow) {
			// summary:
			//		Deselects the given row or range of rows.
			// row: Mixed
			//		Row object (or something that can resolve to one) to deselect
			// toRow: Mixed
			//		If specified, the inclusive range between row and toRow will
			//		be deselected

			this.select(row, toRow, false);
		},

		isSelected: function (object) {
			// summary:
			//		Returns true if the indicated row is selected.

			if (typeof object === 'undefined' || object === null) {
				return false;
			}
			if (!object.element) {
				object = this.row(object);
			}

			// First check whether the given row is indicated in the selection hash;
			// failing that, check if allSelected is true (testing against the
			// allowSelect method if possible)
			return (object.id in this.selection) ? !!this.selection[object.id] :
				this.allSelected && (!object.data || this.allowSelect(object));
		},
	});
});
