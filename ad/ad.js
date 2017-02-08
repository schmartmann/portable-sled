Sled.plugins = {
  onLoad: function(args) {
    console.log("onLoad plugin");
    this.vars = {
      rotator: args.ad.querySelector('#sled_rotator'),
      sprite: args.ad.querySelector('#sled_sprite'),
      start: 0
    };
  },
  rotatorController: function() {
    const touches = {}
    Sled.plugins.vars.rotator.addEventListener('touchstart', function(e) {
      e.preventDefault();

      let { sprite } = Sled.plugins.vars;


      Sled.plugins.vars.start = Sled.engine.Gesture.startTouch[0];

      if( sprite.classList[1] === 'paused'){
        sprite.className = sprite.classList[0]
      }
    }, true);

    Sled.plugins.vars.rotator.addEventListener('touchmove', function(e) {
      e.preventDefault();

      const { sprite, start } = Sled.plugins.vars;

      if (start < e.changedTouches[0].clientX) {
        sprite.className = 'sprite_rotate_right';


      } else if (start > e.changedTouches[0].clientX) {
        sprite.className = 'sprite_rotate_left'
      }

    }, false);

    Sled.plugins.vars.rotator.addEventListener('touchend', function(e) {
      e.preventDefault()

        const { sprite } = Sled.plugins.vars;

        sprite.className += ' paused';
    }, false);
  },
  onClick: function(args) {
    // this is here to log this endpoint when you tap on the ad
    // the resulting array contains coordinates for where a touch ends
    // console.log(Sled.engine.Gesture.lastTouch);
  },
	// Uncomment these plugins as needed
	//
	onBeforeImpression: function() {
		console.log("Ad-specific onBeforeImpression");
	},
	onBeforeImpressionGesture: function() {
		console.log("Ad-specific onBeforeImpressionGesture");
	},
	onImpression: function(args) {
    Sled.plugins.rotatorController(args);
		console.log("Ad-specific onImpression");
	},
	scrollPoints: [
		{
			'entry': 25, // % in view
			'function': function() {
				console.log("Ad-specific scroll point entry at 25%");
			}
		}, {
			'center': true, // if passes the centerline, so >= in that direction
			'function': function() {
				console.log("Ad-specific scroll point at center");
			}
		},{
			'exit': 25, // % in view
			'function': function() {
				console.log("Ad-specific scroll point exit at 25%");
			}
		}
	],
	onFullView: function(args) {
		console.log("Ad-specific onFullView");
	},
	// onClick: function(args) {
	// 	console.log("Ad-specific onClick");
	// },
	onSwipe: function(args) {
		console.log("Ad-specific onSwipe");
	},
	onExit: function(args) {
		console.log("Ad-specific onExit");
	},
	onLock: function() {
		console.log("Potentially used on video sticker locking functionality");
	},
	onVideoQuartile: function(args) {
		switch(args.quartile) {
			case 0:
				console.log('Ad-specific onVideoQuartile-0');
				break;
			case 1:
				console.log('Ad-specific onVideoQuartile-1');
				break;
			case 2:
				console.log('Ad-specific onVideoQuartile-2');
				break;
			case 3:
				console.log('Ad-specific onVideoQuartile-3');
				break;
			case 4:
				console.log('Ad-specific onVideoQuartile-4');
				break;
			default:
				console.log(args.quartile);
		}
	}
};
