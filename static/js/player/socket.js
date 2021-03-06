// soccet connection and events
socket.on('connect', function() {
  console.log('Socket connected');

  // notify the server we have connected
  socket.emit('player_page_connected');

  // let the server know our remote name (if set)
  if (player.comp_name) {
    socket.emit('set_comp_name', {name: player.comp_name});
  }
});

socket.on('songs', function(data) {
  player.song_collection.add(data.songs);
  loadedRestart('songs');
});

socket.on('playlists', function(data) {
  player.playlist_collection.reset();
  player.playlist_collection.add(data.playlists);

  // redraw the sidebar
  MusicApp.router.sidebar();

  // restart the router if we are loading for the first time
  loadedRestart('playlists');
});

// mask to either update or initialise a messenger
var updateMask = function(messenger, message) {
  if (messenger) {
    messenger.update(message);
  } else {
    messenger = Messenger().post(message);
  }

  return messenger;
};

var SCMessenger = null;
socket.on('sc_update', function(data) {
  console.log(data);
  if (data.type == 'started') {
    SCMessenger = Messenger().post('Starting download from SoundCloud of ' + data.count + ' tracks' + (data.not_streamable > 0 ? ' (' + data.not_streamable + ' not streamable)' : ''));
  } else if (data.type == 'added') {
    // it came with a song
    player.song_collection.add(data.content);

    // show an updated message
    var msg = 'song ' + data.completed + ' out of ' + data.count;
    if (data.complete == data.count) {
      msg = 'last song of SoundCloud download';
    }

    SCMessenger = updateMask(SCMessenger, 'Added ' + msg + ' (' + data.content.title + ')');

    // add the song to the SoundCloud playlist
    var sc_plist = player.playlist_collection.getByTitle('SoundCloud').attributes;
    sc_plist.songs.push({_id: data.content._id});

    // render if we are on the SoundCloud playlist
    if (player.playlist.title == 'SoundCloud') {
      // update the model data
      player.playlist = sc_plist;
      player.songs = player.song_collection.getByIds(player.playlist);
      player.queue_pool = player.songs.slice(0);
      player.genShufflePool();

      // resort the model data
      player.resortSongs();
      redrawSongsChangedModel();
    }
  } else if (data.type == 'skipped') {
    SCMessenger = updateMask(SCMessenger, 'Skipped song ' + data.completed + '. Unable to read from SoundCloud');
  } else if (data.type == 'error') {
    SCMessenger = updateMask(SCMessenger, 'Soundcloud track already exists');
  }
});

var YTMessenger = null;
socket.on('yt_update', function(data) {
  console.log(data);
  if (data.type == 'started') {
    YTMessenger = Messenger().post('Starting download from Youtube');
  } else if (data.type == 'added') {
    player.song_collection.add(data.content);
    YTMessenger = updateMask(YTMessenger, 'Added ' + data.content.title);
    var yt_plist = player.playlist_collection.getByTitle('Youtube').attributes;
    yt_plist.songs.push({_id: data.content._id});
    if (player.playlist.title == 'Youtube') {
      // update the model data
      player.playlist = yt_plist;
      player.songs = player.song_collection.getByIds(player.playlist);
      player.queue_pool = player.songs.slice(0);
      player.genShufflePool();

      // resort the model data
      player.resortSongs();

      // redraw the songs view
      redrawSongsChangedModel();
    }
  } else if (data.type == 'error') {
    YTMessenger = updateMask(YTMessenger, data.content);
  }
});

var SongMessenger = null;
socket.on('song_update', function(data) {
  console.log('Updating song info');
  console.log(data);

  // iterate over tracks and update them
  for (var x = 0; x < data.length; x++) {
    // remove the track
    player.song_collection.remove(player.song_collection.where({_id: data[x]._id}));

    // add the track
    player.song_collection.add(data[x]);
  }

  // regenerate the list of current songs
  player.songs = player.song_collection.getByIds(player.playlist);
  player.queue_pool = player.songs.slice(0);
  player.genShufflePool();

  // resort the model data
  player.resortSongs();

  // redraw the view
  redrawSongsChangedModel();

  // redraw info view
  redrawInfoView();
});

var ScanMessenger = null;
var ScanTemplate = 'Scanned {{completed}} out of {{count}}{% if details %}: {{details}}{% endif %}';
socket.on('scan_update', function(data) {
  console.log(data);
  if (ScanMessenger === null) {
    ScanMessenger = Messenger().post(swig.render(ScanTemplate, {locals: data}));
  } else {
    ScanMessenger.update(swig.render(ScanTemplate, {locals: data}));
  }

  // do we need to remove it first?
  if (data.type == 'update') {
    // remove the track
    player.song_collection.remove(player.song_collection.where({_id: data.doc._id}));
  }

  // add the track
  player.song_collection.add(data.doc);

  // add the id to the library
  if (data.type == 'add') {
    addToLibraryPlaylist(data.doc._id);
  }
});

// for when the sync between servers has progressed
var SyncMessenger = null;
var SyncTemplate = 'Synced {{completed}} out of {{count}}{% if content %} - Added {{content.title}}{% endif %}';
socket.on('sync_update', function(data) {
  // log the sync data to the developer tools
  console.log(data);

  if (SyncMessenger === null) {
    SyncMessenger = Messenger().post(swig.render(SyncTemplate, {locals: data}));
  } else {
    SyncMessenger.update(swig.render(SyncTemplate, {locals: data}));
  }

  // add the track to the songs collection
  player.song_collection.add(data.content);

  // add the id to the library
  if (data.type == 'add') {
    addToLibraryPlaylist(data.content._id);
  }

  // if it's completed, refresh the playlists
  if (data.completed == data.count) {
    socket.emit('fetch_playlists');
  }
});

// for when the durations are added
socket.on('duration_update', function(data) {
  player.song_collection.where({_id: data._id})[0].attributes.duration = data.new_duration;
});

// remote controll events
var CommandMessenger = null;
var CommandTemplate = 'Received command \'{{command}}\'.';
socket.on('command', function(data) {
  var command = data.command;

  // show command
  if (CommandMessenger === null) {
    CommandMessenger = Messenger().post(swig.render(CommandTemplate, {locals: data}));
  } else {
    CommandMessenger.update(swig.render(CommandTemplate, {locals: data}));
  }

  // run command
  switch (command){
    case 'next':
      player.nextTrack();
      break;
    case 'prev':
      player.prevTrack();
      break;
    case 'playpause':
      player.togglePlayState();
      break;
    default:
      break;
  }
});

// similar songs data received
socket.on('similar_songs', function(data) {
  if (data.error) {
    Messenger().post('Error generating mix, see log for more info');
  } else {
    if (data.songs.length === 0) {
      Messenger().post('Error generating mix, lastfm failed to find similar songs');
    } else {
      // map them to models we understand
      var songsConverted = data.songs.map(function(song) {
        return {
          _id: 'YOUTUBE_' + song.youtubeId,
          title: song.title,
          album: song.album,
          artist: song.artist,
          albumartist: song.artist,
          display_artist: song.artist,
          genre: song.genre,
          cover_location: song.coverUrl,
          disc: song.discNumber,
          track: song.trackNumber,
          duration: 0,
          play_count: 0,
          is_youtube: true,
          youtube_id: song.youtubeId,
        };
      });

      // add the tracks into the song_collection
      // NOTE: this doesn't add them to the library playlist
      player.song_collection.add(songsConverted);

      // instruct the player to create a view for the mix
      player.showMix(data.reqData, songsConverted);
    }
  }
});

// generic info message reciever
socket.on('message', function(data) {
  Messenger().post(data.message);
});

function redrawSongsChangedModel() {
  MusicApp.router.songview.render();
}

function redrawInfoView() {
  MusicApp.infoRegion.currentView.render();
}

function addToLibraryPlaylist(id) {
  player.playlist_collection.where({_id: 'LIBRARY'})[0].attributes.songs.push({_id: id});
}
