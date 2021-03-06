import Ember from 'ember';
import Shuffle from "audio-visualization/mixins/shuffle";


function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default Ember.Component.extend(Shuffle, {
  facebook: Ember.inject.service(),
  audioContext: null,
  songsService: Ember.inject.service('songs'),
  songs: Ember.computed.alias('songsService.songs'),
  profileUrl: null,
  audioCache: null,

  logGeneratedTimes: false,
  times: [],

  isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
  isConnectingToFacebook: false,
  isConnectedToFacebook: false,
  facebookConnectSuccess: false,
  isShowingControls: false,
  willShowControls: false,
  hasShownControls: false,
  isLoadingPhotos: false,
  isLoadingAudio: false,
  hasLoadedPhotos: false,

  isPlaying: false,
  willPublish: false,
  hasPublished: false,
  isShowingPublishFlow: false,
  loadingProgress: 0,
  photoUrls: null,
  photos: null,
  currentPhotoIndex: 0,

  selectedSong: null,
  audioStartTime: 0,
  error: null,
  frameInterval: null,

  MAX_SAMPLE_PHOTOS_MOBILE: 20,
  MAX_SAMPLE_PHOTOS: 100,
  THRESHOLD: 12,
  FFTSIZE: 1024,
  SMOOTHING: 0.1,
  IMG_FRAMES_PER_SECOND: 40,
  MIN_PHOTO_DURATION_MS: 900,

  $polaroidImg: null,
  _animateIn: false,

  init: function(){
    this._super.apply(this, arguments);
    this.setProperties({
      selectedSong: this.get('songs.firstObject'),
      photos: Ember.A(),
      audioCache: Ember.Map.create()
    });
  },

  didInsertElement() {
    this._super.apply(this, arguments);
    const $polaroidImg = this.$('.polaroid__img');
    this.set('$polaroidImg', $polaroidImg);

    if(this.get('animateIn')) {
      Ember.run.next(() => {
        this.set('_animateIn', true);
      });
    }
  },

  photoPaths: function() {
    const photos = this.get('photos') || Ember.A();
    return photos.map(photo => photo.path);
  }.property('photos'),

  resetPlayer() {
    this.stop();
    const $active = this.$('.polaroid__img__item--active');
    $active.removeClass('polaroid__img__item--active');
    this.setProperties({
      isShowingControls: false,
      isPlaying: false,
      loadingProgress: 0,
      photoUrls: [],
      photos: [],
      currentPhotoIndex: 0
    });
  },

  actions: {
    fbConnect: function(){

      this.resetPlayer();

      const facebook = this.get('facebook');
      this.set('isConnectingToFacebook', true);
      facebook.fbConnect().then(() => {

        facebook.fbFetchProfilePic().then(pic => {
          this.set('profileUrl', pic);
        });

        this.set('facebookConnectSuccess', true);
        setTimeout(() => {
          this.setProperties({
            isConnectedToFacebook: true,
            isConnectingToFacebook: false
          });
        }, 500);

        this.fetchFacebookPhotoUrls();

      }).catch(() => {
        this.setProperties({
          isConnectingToFacebook: false,
          error: 'There was an issue connecting to Facebook, sorry!'
        });
      });
    },

    play() {
      this.play();
    },

    stop() {
      this.stop();
    },

    share() {
      this.stop();
      this.set('willPublish', true);
      Ember.run.later(() => {
        this.set('willPublish', false);
        this.set('isShowingPublishFlow', true);
      }, 1000);
    },

    sampleConnect() {
      this.set('willShowControls', true);
      const photoUrls = [];
      const maxPhotos = this.get('isMobile') ? this.MAX_SAMPLE_PHOTOS_MOBILE : this.MAX_SAMPLE_PHOTOS;
      for(let i = 0; i < maxPhotos; i++) {
        photoUrls.push(`https://unsplash.it/710/455/?random=${i}`);
      }
      this.set('photoUrls', photoUrls);
    }
  },

  fetchFacebookPhotoUrls() {
    this.get('facebook').fbFetchPhotoUrls().then((urls) => {
      if(this.get('isMobile')) {
        return;
      }

      this.set('photoUrls', urls);
    });
  },

  photoUrlsObserver: function() {
    const photoUrls = this.get('photoUrls') || [];
    if(!photoUrls.length) { return }
    this.loadPhotos(photoUrls)
      .then(() => {
        if( this.get('isMobile') ) {
          this.set('isShowingControls', true);
        } else {
          this.initAudio(this.get('selectedSong'));
        }
    });
  }.observes('photoUrls'),

  hasShownControlsObserver: function() {
    const isShowingControls = this.get('isShowingControls');
    if(isShowingControls) {
      Ember.run.later(() => {
        this.set('hasShownControls', true);
      }, 500);
    }
  }.observes('isShowingControls'),

  selectedSongObserver: function(){
    if(!this.get('hasLoadedPhotos')) {
      return;
    }
    if(this.get('isPlaying')) {
      this.stop();
    }
    this.play();
  }.observes('selectedSong'),

  play: function(){
    this.initAudio(this.get('selectedSong'));
  },

  stop: function(){
    let source = this.get('source');
    if(!source) { return }

    const selectedSong = this.get('selectedSong');
    try {
      source.stop();
    } catch(e) {}

    clearInterval(this.get('frameInterval'));
    this.setProperties({
      frameInterval: null,
      isPlaying: false,
      times: []
    });
  },

  initAudio(selectedSong){
    let buffer = selectedSong.buffer;
    if(buffer) {
      this.startPlaying(buffer);
    } else {
      this.fetchAudio(selectedSong.path).then(data => {
        this.startPlaying(data);
      });
    }
  },

  startPlaying(data) {

    this.set('isPlaying', true);

    let context = this.get('audioContext');
    if(!context) {
      context = new AudioContext();
      this.set('audioContext', context);
    }

    if(data instanceof ArrayBuffer) {
      context.decodeAudioData(data, (buffer) => {
        let selectedSong = this.get('selectedSong');
        selectedSong.buffer = buffer;
        this.connectAndStart(buffer, context);
      });
    } else {
      this.connectAndStart(data, context);
    }
  },

  connectAndStart(buffer, context) {
    let source = this.createSource(context);
    let analyser = this.createAnalyser(context);
    source.buffer = buffer;
    source.connect(analyser);
    source.connect(context.destination);
    source.start(0, 0);

    this.setProperties({
      isShowingControls: true,
      audioStartTime: moment()
    });

    this.setPhoto();
    this.compareFrames();
  },

  fetchAudio(url) {
    this.set('isLoadingAudio', true);
    return new Promise(resolve => {
      let request = new XMLHttpRequest();
      request.open('GET', url, true);
      request.responseType = 'arraybuffer';
      request.onload = () => {
        this.set('isLoadingAudio', false);
        resolve(request.response);
      };
      request.send();
    });
  },

  createSource(context) {
    let source = context.createBufferSource();
    if(this.get('logGeneratedTimes')) {
      source.onended = () => {
        console.log(JSON.stringify(this.get('times')));
        this.stop();
      };
    } else {
      this.stop();
    }

    this.set('source', source);
    return source;
  },

  createAnalyser(context) {
    let analyser = context.createAnalyser();
    analyser.fftSize = this.get('FFTSIZE');
    analyser.smoothingTimeConstant = this.get('SMOOTHING');
    this.set('analyser', analyser);
    return analyser;
  },

  setPhoto() {
    const $active = this.$('.polaroid__img__item--active');
    $active.removeClass('polaroid__img__item--active');
    const random = this.getRandomPhoto();
    random.$img.addClass('polaroid__img__item--active');
  },

  loadPhotos: function(photoUrls){
    const promises = [];
    const photos = this.get('photos');
    this.set('isLoadingPhotos', true);

    const containerWidth = this.$('.polaroid__imgs').width();

    photoUrls.forEach(path => {
      const promise = new Promise((resolve) => {
        const $img = this.createImage(path);
        $img.load(() => {
          this.incrementProperty('loadingProgress');
          const imgWidth = $img.width();
          if(imgWidth < containerWidth) {
            const diff = containerWidth - imgWidth;
            $img.width(imgWidth + diff);
            $img.css({height: 'auto'});
          }
          photos.pushObject({ $img, path });
          resolve();
        }).error(resolve);
      });
      promises.push(promise);
    });

    return Ember.RSVP.all(promises).then(() => {
      this.setProperties({
        isLoadingPhotos: false,
        hasLoadedPhotos: true,
        photos
      });
      this.shuffle(photos);
    });
  },

  createImage(path) {
    const $polaroidImgs = this.$('.polaroid__imgs');
    let $img = Ember.$('<img />');
    $img.attr('src', path);
    $img.addClass('polaroid__img__item ken-burns');
    $polaroidImgs.append($img);
    return $img;
  },

  progress: function(){
    let totalCount = this.get('photoUrls.length');
    if(!totalCount) { return 0; }
    let loadingProgress = this.get('loadingProgress');
    return Math.floor(loadingProgress/totalCount*100);
  }.property('loadingProgress', 'photoUrls'),

  minTimeReached: true,

  compareFrames() {
    this.setFrameInterval();
    let lastFrameVal = this.get('lastFrameVal');
    let curFrameVal = this.getFrameVal();
    this.set('lastFrameVal', curFrameVal);
    const change = curFrameVal - lastFrameVal;
    if(Math.floor(change) >= this.THRESHOLD) {

      const minTimeReached = this.get('minTimeReached');
      if(!minTimeReached) { return }

      this.set('minTimeReached', false);
      setTimeout(() => {
        this.set('minTimeReached', true);
      }, this.MIN_PHOTO_DURATION_MS);

      this.setPhoto();
      this.changeBgColor();
    }
  },

  setFrameInterval() {
    let frameInterval = this.get('frameInterval');
    if (!frameInterval) {
      frameInterval = setInterval(this.compareFrames.bind(this), 1000/this.IMG_FRAMES_PER_SECOND);
      this.set('frameInterval', frameInterval);
    }
  },

  changeBgColor() {
    const randomBg = getRandomInt(1, 5);
    let $visaudio = this.get('$visaudio');
    if(!$visaudio) {
      $visaudio = this.$('.visaudio');
      this.set('$visaudio', $visaudio);
    }
    $visaudio.removeClass (function (index, css) {
      return (css.match (/(^|\s)visaudio--\S+/g) || []).join(' ');
    });
    $visaudio.addClass(`visaudio--${randomBg}`);
  },

  getByteFrequencyData() {
    let analyser = this.get('analyser');
    let frequencyData = new Uint8Array(analyser.frequencyBinCount); //empty array
    analyser.getByteFrequencyData(frequencyData); //populated array
    return frequencyData;
  },

  getFrameVal() {
    const arr = this.getByteFrequencyData();
    const values = arr.reduce((val, sum) => sum + val, 0);
    return values/arr.length;
  },

  getRandomPhoto() {
    let photos = this.get('photos');
    let currentPhotoIndex = this.get('currentPhotoIndex');
    if(currentPhotoIndex === photos.length-1) {
      this.shuffle(photos);
      currentPhotoIndex = 0;
      this.set('currentPhotoIndex', 0);
    } else {
      this.incrementProperty('currentPhotoIndex');
    }
    return photos[currentPhotoIndex];
  }

});
