define(['maquette'], function (maquette) {
	return function () {
		var vNode = maquette.h.apply(maquette, arguments);
		if (vNode.properties == null) {
			vNode.properties = {};
		}
		if (vNode.children == null) {
			vNode.children = [];
		}
		return vNode;
	};
});
