define([
	'dojo/_base/declare',
	'dojo/dom-construct',
	'dojo/dom-class',
	'dojo/on',
	'dojo/has',
	'./hyperscript',
	'../util/misc',
	'./vdomUtils',
	'dojo/_base/sniff'
], function (declare, domConstruct, domClass, listen, has, h, miscUtil, vdomUtils) {
	// Add user agent/feature CSS classes needed for structural CSS
	var featureClasses = [];
	if (has('mozilla')) {
		featureClasses.push('has-mozilla');
	}
	if (has('touch')) {
		featureClasses.push('has-touch');
	}
	domClass.add(document.documentElement, featureClasses);

	// Add a feature test for pointer (only Dojo 1.10 has pointer-events and MSPointer tests)
	has.add('pointer', function (global) {
		return 'PointerEvent' in global ? 'pointer' :
			'MSPointerEvent' in global ? 'MSPointer' : false;
	});

	var oddClass = 'dgrid-row-odd',
		evenClass = 'dgrid-row-even',
		scrollbarWidth, scrollbarHeight;

	function byId(id) {
		return document.getElementById(id);
	}

	function cleanupTestElement(element) {
		element.className = '';
		if (element.parentNode) {
			document.body.removeChild(element);
		}
	}

	function getScrollbarSize(element, dimension) {
		// Used by has tests for scrollbar width/height
		element.className = 'dgrid-scrollbar-measure';
		document.body.appendChild(element);
		var size = element['offset' + dimension] - element['client' + dimension];
		cleanupTestElement(element);
		return size;
	}

	has.add('dom-scrollbar-width', function (global, doc, element) {
		return getScrollbarSize(element, 'Width');
	});
	has.add('dom-scrollbar-height', function (global, doc, element) {
		return getScrollbarSize(element, 'Height');
	});

	has.add('dom-rtl-scrollbar-left', function (global, doc, element) {
		var div = document.createElement('div'),
			isLeft;

		element.className = 'dgrid-scrollbar-measure';
		element.setAttribute('dir', 'rtl');
		element.appendChild(div);
		document.body.appendChild(element);

		// position: absolute makes modern IE and Edge always report child's offsetLeft as 0,
		// but other browsers factor in the position of the scrollbar if it is to the left.
		// All versions of IE and Edge are known to move the scrollbar to the left side for rtl.
		isLeft = !!has('ie') || !!has('trident') || /\bEdge\//.test(navigator.userAgent) ||
			div.offsetLeft >= has('dom-scrollbar-width');
		cleanupTestElement(element);
		domConstruct.destroy(div);
		element.removeAttribute('dir');
		return isLeft;
	});

	// var and function for autogenerating ID when one isn't provided
	var autoId = 0;

	function generateId() {
		return List.autoIdPrefix + autoId++;
	}

	// common functions for class and className setters/getters
	// (these are run in instance context)
	function setClass(cls) {
		domClass.replace(this.domNode, cls, this._class || '');

		// Store for later retrieval/removal.
		this._class = cls;
	}

	function getClass() {
		return this._class;
	}

	// window resize event handler, run in context of List instance
	var winResizeHandler = function () {
		if (this._started) {
			this.resize();
		}
	};

	var List = declare(null, {
		tabableHeader: false,

		// showHeader: Boolean
		//		Whether to render header (sub)rows.
		showHeader: false,

		// showFooter: Boolean
		//		Whether to render footer area.  Extensions which display content
		//		in the footer area should set this to true.
		showFooter: false,

		// maintainOddEven: Boolean
		//		Whether to maintain the odd/even classes when new rows are inserted.
		//		This can be disabled to improve insertion performance if odd/even styling is not employed.
		maintainOddEven: true,

		// cleanAddedRules: Boolean
		//		Whether to track rules added via the addCssRule method to be removed
		//		when the list is destroyed.  Note this is effective at the time of
		//		the call to addCssRule, not at the time of destruction.
		cleanAddedRules: true,

		// addUiClasses: Boolean
		//		Whether to add jQuery UI classes to various elements in dgrid's DOM.
		addUiClasses: true,

		// highlightDuration: Integer
		//		The amount of time (in milliseconds) that a row should remain
		//		highlighted after it has been updated.
		highlightDuration: 250,

		postscript: function (params) {
			// perform setup and invoke create in postScript to allow descendants to
			// perform logic before create/postCreate happen (a la dijit/_WidgetBase)
			var grid = this;

			(this._Row = function (id, object, element) {
				this.id = id;
				this.data = object;
				this.element = element;
			}).prototype.remove = function () {
				grid.removeRow(this.element);
			};

			if (params) {
				this.params = params;
				declare.safeMixin(this, params);
			}
		},
		listType: 'list',

		create: function () {
			var cls;
			var params = this.params;
			if (params) {
				// Check for initial class or className in params or on domNode
				cls = params['class'] || params.className;
			}

			// ensure arrays and hashes are initialized
			this.sort = this.sort || [];
			this._listeners = [];
			this._rowIdToObject = {};

			this.postMixInProperties && this.postMixInProperties();

			// Apply id to widget and domNode,
			// from incoming node, widget params, or autogenerated.
			this.id = this.id || generateId();

			// Perform initial rendering, and apply classes if any were specified.
			this.node = this.buildRendering();
			if (cls) {
				setClass.call(this, cls);
			}

			this.postCreate();

			this.renderData();

			// Always calling startup for now.  Lifecycle will probably change.
			this.startup();

			return this.node;
		},
		buildRendering: function () {
			var addUiClasses = this.addUiClasses,
				headerNode,
				bodyNode,
				footerNode,
				isRTL,
				nodeProperties = {},
				nodeClasses = [],
				nodeChildren = [],
				bodyNodeProperties = {};

			// Detect RTL on html/body nodes; taken from dojo/dom-geometry
			isRTL = this.isRTL = (document.body.dir || document.documentElement.dir ||
				document.body.style.direction).toLowerCase() === 'rtl';

			nodeProperties.role = 'grid';
			nodeClasses.push('dgrid');
			nodeClasses.push('dgrid-' + this.listType);
			if (addUiClasses) {
				nodeClasses.push('ui-widget');
			}
			if (!this.showHeader) {
				nodeClasses.push('dgrid-vdom-header-hidden');
			}

			// Place header node (initially hidden if showHeader is false).
			headerNode = this.headerNode = h('div.' + 'dgrid-header.dgrid-header-row' +
				(addUiClasses ? '.ui-widget-header' : ''));
			nodeChildren.push(headerNode);


			// Firefox 4+ adds overflow: auto elements to the tab index by default;
			// force them to not be tabbable, but restrict this to Firefox,
			// since it breaks accessibility support in other browsers
			if (has('ff')) {
				bodyNodeProperties.tabIndex = -1;
			}

			// NOTE: cannot bind this.scrollHandler to 'this' because the vdom doesn't allow
			// event handler functions to change.
			bodyNodeProperties.onscroll = this.scrollHandler;
			bodyNodeProperties.grid = this;

			bodyNode = this.bodyNode = h('div.dgrid-scroller', bodyNodeProperties);
			nodeChildren.push(bodyNode);


			this.headerScrollNode = h('div.dgrid-header.dgrid-header-scroll.dgrid-scrollbar-width' +
			(addUiClasses ? '.ui-widget-header' : ''));
			nodeChildren.push(this.headerScrollNode);

			// Place footer node (initially hidden if showFooter is false).
			footerNode = this.footerNode = h('div.dgrid-footer' + (this.showFooter ? '' : '.dgrid-footer-hidden'));
			nodeChildren.push(footerNode);

			if (isRTL) {
				nodeClasses.push('dgrid-rtl');
				if (has('dom-rtl-scrollbar-left')) {
					nodeClasses.push('dgrid-rtl-swap');
				}
			}

			this.configStructure();
			this.renderHeader();

			this.contentNode = this.touchNode = h('div.dgrid-content' + (addUiClasses ? '.ui-widget-content' : ''));
			bodyNode.children.push(this.contentNode);

			// add window resize handler, with reference for later removal if needed
			this._listeners.push(this._resizeHandle = listen(window, 'resize',
				miscUtil.throttleDelayed(winResizeHandler, this)));

			return h('div.' + nodeClasses.join('.'), nodeProperties, nodeChildren);
		},

		scrollHandler: function (event) {
			var grid = event.target.grid;
			if (grid.showHeader) {
				// keep the header aligned with the body
				grid.headerNode.domNode.scrollLeft = event.scrollLeft || grid.bodyNode.domNode.scrollLeft;
			}
			// re-fire, since browsers are not consistent about propagation here
			event.stopPropagation();
			listen.emit(grid.node.domNode, 'scroll', {scrollTarget: grid.bodyNode.domNode});

			if (this._processScroll) {
				this._processScroll();
			}
		},

		postCreate: function () {
			if (this._processScroll) {
				this._processScroll = miscUtil[this.pagingMethod](this._processScroll, null, this.pagingDelay);
			}
		},

		startup: function () {
			// summary:
			//		Called automatically after postCreate if the component is already
			//		visible; otherwise, should be called manually once placed.

			if (this._started) {
				return;
			}
			this.inherited(arguments);
			this._started = true;
			this.resize();
			// apply sort (and refresh) now that we're ready to render
			this.set('sort', this.sort);
			this.refresh();
		},

		configStructure: function () {
			// does nothing in List, this is more of a hook for the Grid
		},
		resize: function () {

			if (!scrollbarWidth) {
				// Measure the browser's scrollbar width using a DIV we'll delete right away
				scrollbarWidth = has('dom-scrollbar-width');
				scrollbarHeight = has('dom-scrollbar-height');

				// Avoid issues with certain widgets inside in IE7, and
				// ColumnSet scroll issues with all supported IE versions
				if (has('ie')) {
					scrollbarWidth++;
					scrollbarHeight++;
				}

				// add rules that can be used where scrollbar width/height is needed
				miscUtil.addCssRule('.dgrid-scrollbar-width', 'width: ' + scrollbarWidth + 'px');
				miscUtil.addCssRule('.dgrid-scrollbar-height', 'height: ' + scrollbarHeight + 'px');

				if (scrollbarWidth !== 17) {
					// for modern browsers, we can perform a one-time operation which adds
					// a rule to account for scrollbar width in all grid headers.
					miscUtil.addCssRule('.dgrid-header-row', 'right: ' + scrollbarWidth + 'px');
					// add another for RTL grids
					miscUtil.addCssRule('.dgrid-rtl-swap .dgrid-header-row', 'left: ' + scrollbarWidth + 'px');
				}
			}
		},

		addCssRule: function (selector, css) {
			// summary:
			//		Version of util/misc.addCssRule which tracks added rules and removes
			//		them when the List is destroyed.

			var rule = miscUtil.addCssRule(selector, css);
			if (this.cleanAddedRules) {
				// Although this isn't a listener, it shares the same remove contract
				this._listeners.push(rule);
			}
			return rule;
		},

		on: function (eventType, listener) {
			// delegate events to the domNode
			var signal = listen(this.domNode, eventType, listener);
			if (!has('dom-addeventlistener')) {
				this._listeners.push(signal);
			}
			return signal;
		},

		cleanup: function () {
		},

		destroy: function () {
			// summary:
			//		Destroys this grid

			// Remove any event listeners and other such removables
			if (this._listeners) { // Guard against accidental subsequent calls to destroy
				for (var i = this._listeners.length; i--;) {
					this._listeners[i].remove();
				}
				this._listeners = null;
			}

			this._started = false;
			this.cleanup();
			// destroy DOM
			domConstruct.destroy(this.domNode);
		},
		refresh: function () {
			// summary:
			//		refreshes the contents of the grid

			this._rowIdToObject = {};
			this._autoRowId = 0;
		},

		highlightRow: function (rowElement, delay) {
			// summary:
			//		Highlights a row.  Used when updating rows due to store
			//		notifications, but potentially also useful in other cases.
			// rowElement: Object
			//		Row element (or object returned from the row method) to
			//		highlight.
			// delay: Number
			//		Number of milliseconds between adding and removing the
			//		ui-state-highlight class.

			var classes = 'dgrid-highlight' + (this.addUiClasses ? ' ui-state-highlight' : '');

			rowElement = rowElement.element || rowElement;
			domClass.add(rowElement, classes);
			setTimeout(function () {
				domClass.remove(rowElement, classes);
			}, delay || this.highlightDuration);
		},

		renderArray: function (results) {
			this.rowData = results;
			this.projector.scheduleRender();
		},

		renderData: function () {
			// summary:
			//		Renders an array of objects as rows, before the given node.

			options = options || {};
			var results = this.rowData;
			if (!results) {
				return;
			}
			var start = options.start || 0,
				i = 0,
				len = results.length;

			this._lastCollection = results;

			// Insert a row for each item into the document fragment
			for (i = 0; i < len; i++) {
				this.contentNode.children.push(this.insertRow(results[i], null, start++, options));
			}
		},

		renderHeader: function () {
			// no-op in a plain list
		},

		_autoRowId: 0,
		insertRow: function (object, beforeNode, i, options) {
			// summary:
			//		Creates a single row in the grid.

			// Include parentId within row identifier if one was specified in options.
			// (This is used by tree to allow the same object to appear under
			// multiple parents.)
			var id = this.id + '-row-' + ((this.collection && this.collection.getIdentity) ?
						this.collection.getIdentity(object) : this._autoRowId++);

			var rowNode = this.renderRow(object, options);
			vdomUtils.addClassToVNode(rowNode, 'dgrid-row');
			vdomUtils.addClassToVNode(rowNode, (i % 2 === 1 ? oddClass : evenClass));
			if (this.addUiClasses) {
				vdomUtils.addClassToVNode('ui-state-default');
			}
			// Get the row id for easy retrieval
			rowNode.properties = rowNode.properties || {};
			rowNode.properties.id = id;
			rowNode.properties.key = id;
			this._rowIdToObject[id] = object;

			rowNode.properties.rowIndex = i;
			return rowNode;
		},
		renderRow: function (value) {
			// summary:
			//		Responsible for returning the DOM for a single row in the grid.
			// value: Mixed
			//		Value to render
			// options: Object?
			//		Optional object with additional options
			return h('div', value);
		},
		removeRow: function (rowElement, preserveDom) {
			// summary:
			//		Simply deletes the node in a plain List.
			//		Column plugins may aspect this to implement their own cleanup routines.
			// rowElement: Object|DOMNode
			//		Object or element representing the row to be removed.
			// preserveDom: Boolean?
			//		If true, the row element will not be removed from the DOM; this can
			//		be used by extensions/plugins in cases where the DOM will be
			//		massively cleaned up at a later point in time.
			// options: Object?
			//		May be specified with a `rows` property for the purpose of
			//		cleaning up collection tracking (used by `_StoreMixin`).

			rowElement = rowElement.element || rowElement;
			delete this._rowIdToObject[rowElement.id];
			if (!preserveDom) {
				domConstruct.destroy(rowElement);
			}
		},

		row: function (target) {
			// summary:
			//		Get the row object by id, object, node, or event
			var id;

			if (target instanceof this._Row) {
				return target; // No-op; already a row
			}

			if (target.target && target.target.nodeType) {
				// Event
				target = target.target;
			}
			if (target.nodeType) {
				// Row element, or child of a row element
				var object;
				do {
					var rowId = target.id;
					if ((object = this._rowIdToObject[rowId])) {
						return new this._Row(rowId.substring(this.id.length + 5), object, target);
					}
					target = target.parentNode;
				} while (target && target !== this.domNode);
				return;
			}

			if (typeof target === 'object') {
				// Assume target represents a collection item
				id = this.collection.getIdentity(target);
			}
			else {
				// Assume target is a row ID
				id = target;
				target = this._rowIdToObject[this.id + '-row-' + id];
			}
			return new this._Row(id, target, byId(this.id + '-row-' + id));
		},
		cell: function (target) {
			// this doesn't do much in a plain list
			return {
				row: this.row(target)
			};
		},

		_move: function (item, steps, targetClass, visible) {
			var nextSibling, current, element;
			// Start at the element indicated by the provided row or cell object.
			element = current = item.element;
			steps = steps || 1;

			do {
				// Outer loop: move in the appropriate direction.
				if ((nextSibling = current[steps < 0 ? 'previousSibling' : 'nextSibling'])) {
					do {
						// Inner loop: advance, and dig into children if applicable.
						current = nextSibling;
						if (current && (current.className + ' ').indexOf(targetClass + ' ') > -1) {
							// Element with the appropriate class name; count step, stop digging.
							element = current;
							steps += steps < 0 ? 1 : -1;
							break;
						}
						// If the next sibling isn't a match, drill down to search, unless
						// visible is true and children are hidden.
					} while ((nextSibling = (!visible || !current.hidden) &&
						current[steps < 0 ? 'lastChild' : 'firstChild']));
				}
				else {
					current = current.parentNode;
					if (!current || current === this.bodyNode || current === this.headerNode) {
						// Break out if we step out of the navigation area entirely.
						break;
					}
				}
			} while (steps);
			// Return the final element we arrived at, which might still be the
			// starting element if we couldn't navigate further in that direction.
			return element;
		},

		up: function (row, steps, visible) {
			// summary:
			//		Returns the row that is the given number of steps (1 by default)
			//		above the row represented by the given object.
			// row:
			//		The row to navigate upward from.
			// steps:
			//		Number of steps to navigate up from the given row; default is 1.
			// visible:
			//		If true, rows that are currently hidden (i.e. children of
			//		collapsed tree rows) will not be counted in the traversal.
			// returns:
			//		A row object representing the appropriate row.  If the top of the
			//		list is reached before the given number of steps, the first row will
			//		be returned.
			if (!row.element) {
				row = this.row(row);
			}
			return this.row(this._move(row, -(steps || 1), 'dgrid-row', visible));
		},
		down: function (row, steps, visible) {
			// summary:
			//		Returns the row that is the given number of steps (1 by default)
			//		below the row represented by the given object.
			// row:
			//		The row to navigate downward from.
			// steps:
			//		Number of steps to navigate down from the given row; default is 1.
			// visible:
			//		If true, rows that are currently hidden (i.e. children of
			//		collapsed tree rows) will not be counted in the traversal.
			// returns:
			//		A row object representing the appropriate row.  If the bottom of the
			//		list is reached before the given number of steps, the last row will
			//		be returned.
			if (!row.element) {
				row = this.row(row);
			}
			return this.row(this._move(row, steps || 1, 'dgrid-row', visible));
		},

		scrollTo: function (options) {
			if (typeof options.x !== 'undefined') {
				this.bodyNode.scrollLeft = options.x;
			}
			if (typeof options.y !== 'undefined') {
				this.bodyNode.scrollTop = options.y;
			}
		},

		getScrollPosition: function () {
			return {
				x: this.bodyNode.scrollLeft,
				y: this.bodyNode.scrollTop
			};
		},

		get: function (/*String*/ name /*, ... */) {
			// summary:
			//		Get a property on a List instance.
			//	name:
			//		The property to get.
			//	returns:
			//		The property value on this List instance.
			// description:
			//		Get a named property on a List object. The property may
			//		potentially be retrieved via a getter method in subclasses. In the base class
			//		this just retrieves the object's property.

			var fn = '_get' + name.charAt(0).toUpperCase() + name.slice(1);

			if (typeof this[fn] === 'function') {
				return this[fn].apply(this, [].slice.call(arguments, 1));
			}

			// Alert users that try to use Dijit-style getter/setters so they don’t get confused
			// if they try to use them and it does not work
			if (!has('dojo-built') && typeof this[fn + 'Attr'] === 'function') {
				console.warn('dgrid: Use ' + fn + ' instead of ' + fn + 'Attr for getting ' + name);
			}

			return this[name];
		},

		set: function (/*String*/ name, /*Object*/ value /*, ... */) {
			//	summary:
			//		Set a property on a List instance
			//	name:
			//		The property to set.
			//	value:
			//		The value to set in the property.
			//	returns:
			//		The function returns this List instance.
			//	description:
			//		Sets named properties on a List object.
			//		A programmatic setter may be defined in subclasses.
			//
			//		set() may also be called with a hash of name/value pairs, ex:
			//	|	myObj.set({
			//	|		foo: "Howdy",
			//	|		bar: 3
			//	|	})
			//		This is equivalent to calling set(foo, "Howdy") and set(bar, 3)

			if (typeof name === 'object') {
				for (var k in name) {
					this.set(k, name[k]);
				}
			}
			else {
				var fn = '_set' + name.charAt(0).toUpperCase() + name.slice(1);

				if (typeof this[fn] === 'function') {
					this[fn].apply(this, [].slice.call(arguments, 1));
				}
				else {
					// Alert users that try to use Dijit-style getter/setters so they don’t get confused
					// if they try to use them and it does not work
					if (!has('dojo-built') && typeof this[fn + 'Attr'] === 'function') {
						console.warn('dgrid: Use ' + fn + ' instead of ' + fn + 'Attr for setting ' + name);
					}

					this[name] = value;
				}
			}

			return this;
		},

		// Accept both class and className programmatically to set domNode class.
		_getClass: getClass,
		_setClass: setClass,
		_getClassName: getClass,
		_setClassName: setClass,

		_setSort: function (property, descending) {
			// summary:
			//		Sort the content
			// property: String|Array
			//		String specifying field to sort by, or actual array of objects
			//		with property and descending properties
			// descending: boolean
			//		In the case where property is a string, this argument
			//		specifies whether to sort ascending (false) or descending (true)

			this.sort = typeof property !== 'string' ? property :
				[{property: property, descending: descending}];

			this._applySort();
		},

		_applySort: function () {
			// summary:
			//		Applies the current sort
			// description:
			//		This is an extension point to allow specializations to apply the sort differently

			this.refresh();

			if (this._lastCollection) {
				var sort = this.sort;
				if (sort && sort.length > 0) {
					var property = sort[0].property,
						descending = !!sort[0].descending;
					this._lastCollection.sort(function (a, b) {
						var aVal = a[property], bVal = b[property];
						// fall back undefined values to "" for more consistent behavior
						if (aVal === undefined) {
							aVal = '';
						}
						if (bVal === undefined) {
							bVal = '';
						}
						return aVal === bVal ? 0 : (aVal > bVal !== descending ? 1 : -1);
					});
				}
				this.renderArray(this._lastCollection);
			}
		},

		_setShowHeader: function (show) {
			// this is in List rather than just in Grid, primarily for two reasons:
			// (1) just in case someone *does* want to show a header in a List
			// (2) helps address IE < 8 header display issue in List

			var headerNode = this.headerNode;

			this.showHeader = show;

			// add/remove class which has styles for "hiding" header
			domClass.toggle(headerNode, 'dgrid-header-hidden', !show);

			this.renderHeader();
			this.resize(); // resize to account for (dis)appearance of header

			if (show) {
				// Update scroll position of header to make sure it's in sync.
				headerNode.scrollLeft = this.getScrollPosition().x;
			}
		},

		_setShowFooter: function (show) {
			this.showFooter = show;

			// add/remove class which has styles for hiding footer
			domClass.toggle(this.footerNode, 'dgrid-footer-hidden', !show);

			this.resize(); // to account for (dis)appearance of footer
		}
	});

	List.autoIdPrefix = 'dgrid_';

	return List;
});
