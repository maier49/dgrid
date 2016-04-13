define([
	'./List',
	'./_StoreMixin',
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/dom-construct',
	'dojo/on',
	'dojo/when',
	'../util/misc',
	'./hyperscript'
], function (List, _StoreMixin, declare, lang, domConstruct, on, when, miscUtil, h) {

	return declare([ List, _StoreMixin ], {
		// summary:
		//		Extends List to include virtual scrolling functionality, querying a
		//		dojo/store instance for the appropriate range when the user scrolls.

		// minRowsPerPage: Integer
		//		The minimum number of rows to request at one time.
		minRowsPerPage: 25,

		// maxRowsPerPage: Integer
		//		The maximum number of rows to request at one time.
		maxRowsPerPage: 250,

		// maxEmptySpace: Integer
		//		Defines the maximum size (in pixels) of unrendered space below the
		//		currently-rendered rows. Setting this to less than Infinity can be useful if you
		//		wish to limit the initial vertical scrolling of the grid so that the scrolling is
		// 		not excessively sensitive. With very large grids of data this may make scrolling
		//		easier to use, albiet it can limit the ability to instantly scroll to the end.
		maxEmptySpace: Infinity,

		// bufferRows: Integer
		//	  The number of rows to keep ready on each side of the viewport area so that the user can
		//	  perform local scrolling without seeing the grid being built. Increasing this number can
		//	  improve perceived performance when the data is being retrieved over a slow network.
		bufferRows: 10,

		// farOffRemoval: Integer
		//		Defines the minimum distance (in pixels) from the visible viewport area
		//		rows must be in order to be removed.  Setting to Infinity causes rows
		//		to never be removed.
		farOffRemoval: 2000,

		// queryRowsOverlap: Integer
		//		Indicates the number of rows to overlap queries. This helps keep
		//		continuous data when underlying data changes (and thus pages don't
		//		exactly align)
		queryRowsOverlap: 0,

		// pagingMethod: String
		//		Method (from dgrid/util/misc) to use to either throttle or debounce
		//		requests.  Default is "debounce" which will cause the grid to wait until
		//		the user pauses scrolling before firing any requests; can be set to
		//		"throttleDelayed" instead to progressively request as the user scrolls,
		//		which generally incurs more overhead but might appear more responsive.
		pagingMethod: 'debounce',

		// pagingDelay: Integer
		//		Indicates the delay (in milliseconds) imposed upon pagingMethod, to wait
		//		before paging in more data on scroll events. This can be increased to
		//		reduce client-side overhead or the number of requests sent to a server.
		pagingDelay: miscUtil.defaultDelay,

		// keepScrollPosition: Boolean
		//		When refreshing the list, controls whether the scroll position is
		//		preserved, or reset to the top.  This can also be overridden for
		//		specific calls to refresh.
		keepScrollPosition: false,

		// rowHeight: Number
		//		Average row height, computed in renderQuery during the rendering of
		//		the first range of data.
		rowHeight: 0,

		destroy: function () {
			this.inherited(arguments);
			if (this._refreshTimeout) {
				clearTimeout(this._refreshTimeout);
			}
		},

		refresh: function (options) {
			// summary:
			//		Refreshes the contents of the grid.
			// options: Object?
			//		Optional object, supporting the following parameters:
			//		* keepScrollPosition: like the keepScrollPosition instance property;
			//			specifying it in the options here will override the instance
			//			property's value for this specific refresh call only.

			var self = this,
				keep = (options && options.keepScrollPosition);

			// Fall back to instance property if option is not defined
			if (typeof keep === 'undefined') {
				keep = this.keepScrollPosition;
			}

			// Store scroll position to be restored after new total is received
			if (keep) {
				this._previousScrollPosition = this.getScrollPosition();
			}

			this.inherited(arguments);
			if (this._renderedCollection) {
				// render the query

				// renderQuery calls _trackError internally
				return this._processScroll();
			}
		},

		resize: function () {
			this.inherited(arguments);
			if (!this.rowHeight) {
				this._calcAverageRowHeight(this.contentNode.getElementsByClassName('dgrid-row'));
			}
			this._processScroll();
		},

		cleanup: function () {
			this.inherited(arguments);
			this.preload = null;
		},

		_getFirstRowSibling: function (container) {
			// summary:
			//		Returns the DOM node that a new row should be inserted before
			//		when there are no other rows in the current result set.
			//		In the case of OnDemandList, this will always be the last child
			//		of the container (which will be a trailing preload node).
			return container.lastChild;
		},

		_calcRowHeight: function (rowElement) {
			// summary:
			//		Calculate the height of a row. This is a method so it can be overriden for
			//		plugins that add connected elements to a row, like the tree

			var sibling = rowElement.nextSibling;

			// If a next row exists, compare the top of this row with the
			// next one (in case "rows" are actually rendering side-by-side).
			// If no next row exists, this is either the last or only row,
			// in which case we count its own height.
			if (sibling && !/\bdgrid-preload\b/.test(sibling.className)) {
				return sibling.offsetTop - rowElement.offsetTop;
			}

			return rowElement.offsetHeight;
		},

		_calcAverageRowHeight: function (rowElements) {
			// summary:
			//		Sets this.rowHeight based on the average from heights of the provided row elements.

			var count = rowElements.length;
			var height = 0;
			for (var i = 0; i < count; i++) {
				height += this._calcRowHeight(rowElements[i]);
			}
			// only update rowHeight if elements were passed and are in flow
			if (count && height) {
				this.rowHeight = height / count;
			}
		},

		_processScroll: function (evt) {
			// summary:
			//		Checks to make sure that everything in the viewable area has been
			//		downloaded, and triggering a request for the necessary data when needed.

			if (!this.rowHeight) {
				return;
			}

			var self = this;
			var visibleTop = this._visibleTop = (evt && evt.scrollTop) || this.getScrollPosition().y;
			var startingIndex = visibleTop/this.rowHeight;
			var count = (this.bodyNode.offsetHeight/this.rowHeight) + this.bufferRows;
			var end = startingIndex + count;
			var startQuery = startingIndex;
			var endQuery = end;
			if (this._cached) {
				while(this._cached[startQuery] && startQuery < endQuery) {
					startQuery++;
				}

				while(this._cached[end] && startQuery > endQuery) {
					endQuery--;
				}
			} else {
				this._cached = [];
			}

			if (startQuery !== endQuery) {
				var results = this._renderedCollection.fetchRange({
					start: startQuery,
					end: endQuery
				});
				return results.totalLength.then(function(length) {
					self._totalRows = length;
					return results.then(function(data) {
						self._cached.splice.apply(self._cached, [ startQuery, 0].concat(data));
						self.renderArray(self._cached.slice(startingIndex, end));
					});
				});
			} else {
				self.renderArray(this._cached.slice(startingIndex, end));
				return when();
			}
		},

		renderData: function() {
			this.inherited(arguments);
			if (this.rowHeight && this._totalRows) {
				var results = this.rowData;
				var totalLength = this.rowHeight * this._totalRows;
				this.contentNode.children.unshift(
					h('div', { style: 'height: ' + this._visibleTop + 'px;'})
				);

				this.contentNode.children.push(
					h('div', { style: 'height: ' + (totalLength - this._visibleTop - (this.rowHeight * results)) + 'px;'})
				);
			}
		}
	});

});
