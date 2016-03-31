define([], function () {
	return {
		addClassToVNode: function (vnode, classname) {
			if (!classname) {
				return;
			}
			var parts = vnode.vnodeSelector.split('#');

			vnode.vnodeSelector = parts[0] + '.' + classname + (parts.length > 1 ? parts[1] : '');
		}
	};
});
