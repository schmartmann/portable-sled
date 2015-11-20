Sled.plugins = {
	onLoad: function(args) {
		var adWidth = window.screen.availWidth;
		args.ad.style.height = adWidth + 'px';
	},
	onImpression: function(args) {
	},
	onScroll: function(args) {
	},
	onFullView: function(args) {
	},
	onClick: function(args) {
	},
	onSwipe: function(args) {
	},
	onExit: function(args) {
	}
};