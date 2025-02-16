import React, {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import PropTypes from 'prop-types';
import $ from 'jquery';
import {Requests} from '@skywatch/api';
import ArchivesPlayer from './ArchivesPlayer';
import FlvPlayer from './FlvPlayer';
import {useInterval, usePageVisibility} from './hooks';
import LoadingSpinner from './style/images/loading.gif';
import {STATUS_OK, STATUS_END, STATUS_HOLE} from './Constants';

const hide_ff = false;

const loadingStyle = {
  height: '432px',
  width: '768px',
  backgroundImage: `url(${LoadingSpinner})`,
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '70px 70px',
  transition: 'opacity .20s linear',
  backgroundColor: 'rgba(0,0,0,0.3)',
  position: 'absolute',
  zIndex: 5,
};

const scale_table = {
  get: function(scale, timestamp) {
    if (scale !== 'month') {
      return this.table[scale];
    } else {
      const date = new Date(timestamp * 1000);
      const month = date.getMonth() + 1;
      if ([1, 3, 5, 7, 8, 10, 12].includes(month)) {
        return 31 * 24 * 60 * 60;
      } else if ([4, 6, 9, 11].includes(month)) {
        return 30 * 24 * 60 * 60;
      } else {
        return 29 * 24 * 60 * 60;
      }
    }
  },
  table: {
    month: 30 * 24 * 60 * 60,
    week: 7 * 24 * 60 * 60,
    day: 24 * 60 * 60,
    hour: 60 * 60,
  },
};

const getScaleStartTime = function(timestamp, scale) {
  const date = new Date(timestamp * 1000);
  date.setSeconds(0);
  if (scale === 'hour') {
    date.setMinutes(0);
  } else if (scale === 'day') {
    date.setMinutes(0);
    date.setHours(0);
  } else if (scale === 'week') {
    date.setMinutes(0);
    date.setHours(0);
    date.setTime(date.getTime() - date.getDay() * 24 * 60 * 60 * 1000);
  } else if (scale === 'month') {
    date.setMinutes(0);
    date.setHours(0);
    date.setDate(1);
  }

  return Math.floor(date.getTime() / 1000);
};

const getTimeData = function(timestamp) {
  timestamp = parseInt(timestamp, 10);
  if (timestamp.toString().length === 10) timestamp = timestamp * 1000;
  const $time = new Date(parseInt(timestamp));
  const $time2 = new Date(parseInt(timestamp) + 24 * 60 * 60 * 1000);
  const $now = new Date();
  let date_display = '';
  if (
    $time.getFullYear() === $now.getFullYear() &&
    $time.getMonth() === $now.getMonth() &&
    $time.getDate() === $now.getDate()
  ) {
    date_display = '今天';
  } else {
    if (
      $time2.getFullYear() == $now.getFullYear() &&
      $time2.getMonth() == $now.getMonth() &&
      $time2.getDate() == $now.getDate()
    ) {
      date_display = '昨天';
    } else {
      date_display = $time.getMonth() + 1 + '/';
      date_display +=
        $time.getDate() < 10 ? '0' + $time.getDate() : $time.getDate();
    }
  }

  let hour = $time.getHours() >= 10 ? $time.getHours() : '0' + $time.getHours();
  let minute =
    $time.getMinutes() >= 10 ? $time.getMinutes() : '0' + $time.getMinutes();
  let second =
    $time.getSeconds() >= 10 ? $time.getSeconds() : '0' + $time.getSeconds();
  const time_display = hour + ':' + minute + ':' + second;

  hour = $time.getHours();
  let post_fix = 'AM';
  if (hour >= 12) {
    post_fix = 'PM';
    if (hour > 12) {
      hour -= 12;
    }
  } else if (hour === 0) {
    hour = 12;
  }

  const hour_time_display = hour + ' ' + post_fix;

  return {
    date_display: date_display,
    time_display: time_display,
    hour_time_display: hour_time_display,
  };
};

const resetActiveButton = () => {
  $('#control-pause')
    .parent()
    .removeClass('active');
  $('#control-fastforward')
    .parent()
    .removeClass('active');
  $('#control-play')
    .parent()
    .removeClass('active');
};

let Skywatch = {
  archives: [],
  all_dataset: {},
  tick_counter: 0,
  next_archive: null,
  last_timestamp: false,
};
const CameraView = forwardRef(({deviceId, renderLoading, controls}, ref) => {
  const now = Math.floor(new Date().getTime() / 1000);
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const [seekTime, setSeekTime] = useState('');
  const [currentTime, setCurrentTime] = useState(now);
  const [archive, setArchive] = useState(null);
  const [scale, setScale] = useState('hour');
  const [leftTimestamp, setLeftTimestamp] = useState(
    getScaleStartTime(now, scale),
  );
  const [rightTimestamp, setRightTimestamp] = useState(
    leftTimestamp + scale_table.get(scale, leftTimestamp),
  );
  const [smart_ff, setSmart_ff] = useState(0);
  const [delay, setDelay] = useState(null);
  const [isMuted, setIsMuted] = useState(true);
  const [highlightStart, sethigHlightStart] = useState(0);
  const [highlightEnd, sethigHlightEnd] = useState(0);
  const [flvCounter, setFlvCounter] = useState(0); // use counter as key for <FlvPlayer />
  const [archiveCounter, setArchiveCounter] = useState(0); // use counter as key for <ArchivesPlayer />
  const [dragging, setDragging] = useState(false);
  const [cacheTime, setCacheTime] = useState(0);

  const isVisible = usePageVisibility(() =>
    document.hidden ? onBlur() : onFocus(),
  );

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    onChangeTimeAndScale(scale, leftTimestamp, rightTimestamp);
  }, [scale, leftTimestamp, rightTimestamp]);

  useEffect(() => {
    controls && onChangeCurrentTime(currentTime);
  }, [currentTime]);

  useEffect(() => {
    loading || smart_ff ? setDelay(null) : setDelay(1000);
  }, [loading, smart_ff]);

  useInterval(function() {
    updateCurrentTime();
    updateMeta();
  }, delay);

  useImperativeHandle(ref, () => ({
    play,
    pause,
    fastForward,
    toggleMute,
    goLive,
    seek,
    getAllArchives: () => Skywatch.archives,
    isLive: () => isLive,
  }));

  const init = () => {
    renderScaleIndicator();
    fetchAllInterval(deviceId, 'CloudArchives', Skywatch.archives).progress(
      () => {
        if (controls) {
          document
            .getElementById('timeline_container')
            .classList.remove('loading');
          $('#timeline_container').css('left', '-100%');
          $('#timeline_container').css('width', '300%');
        }
      },
    );
  };

  const goLive = () => {
    setLoading(true);
    if (smart_ff) setSmart_ff(0);
    setIsLive(true);
    setArchive(null);
    setFlvCounter(prev => prev + 1);
    updateCurrentTime(now);

    if (controls) {
      resetActiveButton();
      $('#control-play')
        .parent()
        .addClass('active');
      setDelay(1000);
      const now = Math.floor(new Date().getTime() / 1000);
      const updatedLeftTimestamp = getScaleStartTime(now, scale);
      const updatedRightTimestamp =
        updatedLeftTimestamp + scale_table.get(scale, updatedLeftTimestamp);
      updateTimebar(
        leftTimestamp,
        rightTimestamp,
        updatedLeftTimestamp,
        updatedRightTimestamp,
      );
      onHighlightTimeChange(0, 0);
      setLeftTimestamp(updatedLeftTimestamp);
      setRightTimestamp(updatedRightTimestamp);
    }
  };

  const seek = (timestamp, is_smart_ff = smart_ff) => {
    setLoading(true);
    const targetArchive = seekTargetArchive(timestamp);

    // handle click on gap
    if (targetArchive.timestamp) {
      const timestamp_found = parseInt(targetArchive.timestamp);
      const length = parseInt(targetArchive.length);
      if (timestamp > timestamp_found + length) {
        goLive();
        return;
      }
    }
    setArchive(targetArchive);
    setSeekTime(toArchiveTime(targetArchive, timestamp, is_smart_ff));
    setArchiveCounter(prev => prev + 1);

    setIsLive(timestamp >= now);
    updateCurrentTime(timestamp);

    if (controls) {
      setBubbleTime(timestamp, $('#cursor_bubble'), true);
      const highlight_start = parseInt(targetArchive.timestamp);
      const highlight_end =
        parseInt(targetArchive.timestamp) + parseInt(targetArchive.length);
      onHighlightTimeChange(highlight_start, highlight_end);
    }
  };

  const seekTargetArchive = targetTimestamp => {
    const targetArchive = Skywatch.archives
      .map(archive => {
        let diff = archive.timestamp - targetTimestamp;
        if (diff < 0 && Math.abs(diff) >= archive.length) {
          diff = Number.MAX_VALUE;
        }
        return {...archive, diff};
      })
      .sort((a, b) => a.diff - b.diff)[0];
    return targetArchive;
  };

  const onScaleClick = e => {
    if ($('#timeline_container.loading').length !== 0) return; // is loading
    let key = 'hour';
    const id = e.target.id;
    const $el = $(`#${id}`);
    if (id === 'control-day') {
      key = 'day';
    } else if (id === 'control-week') {
      key = 'week';
    } else if (id === 'control-month') {
      key = 'month';
    }
    changeScale(key);

    $el
      .parents('.button_group')
      .find('.control_button')
      .removeClass('active');
    $el.parents('.control_button').addClass('active');
  };

  const changeScale = scale => {
    const start = getScaleStartTime(currentTime, scale);
    const end = start + scale_table.get(scale);
    setScale(scale);
    setLeftTimestamp(start);
    setRightTimestamp(end);
  };

  const fetchAllInterval = function(deviceId, scope, archives) {
    const deferred = $.Deferred();
    const now = Math.floor(new Date().getTime() / 1000);

    Requests.getCacheTime(now, deviceId).then(res => {
      if (res.timestamp) {
        setCacheTime(parseInt(res.timestamp, 10));
      } else {
        setCacheTime(0);
      }
      deferred.progress([]);
    });
    const current_timestamp = Math.round(new Date().getTime() / 1000);
    fetchNextInterval(
      deviceId,
      scope,
      archives,
      deferred,
      current_timestamp,
      false,
      false,
    );
    return deferred;
  };

  // TODO: get next archive video in advance
  const fetchNextInterval = async function(
    deviceId,
    scope,
    archives,
    deferred,
    end_timestamp = false,
    start_timestamp = false,
    next_url = false,
  ) {
    const one_month_sec = 86400 * 30;

    let temp_archives_start_time = 0;
    let temp_archives_end_time = 0;
    if (end_timestamp) {
      temp_archives_end_time = parseInt(end_timestamp);
      if (!start_timestamp) {
        temp_archives_start_time = end_timestamp - one_month_sec;
      }
    }

    //parse next_url
    if (next_url) {
      let parse_start_time = new Array();
      let parse_end_time = new Array();

      const remove_ques = next_url.split('?');
      const remove_and = remove_ques[1].split('&');
      for (let i = 0; i < remove_and.length; i++) {
        if (parse_start_time.length < 2)
          parse_start_time = remove_and[i].split('start_time=');
        if (parse_end_time.length < 2)
          parse_end_time = remove_and[i].split('end_time=');
      }
      temp_archives_start_time = parse_start_time[1];
      temp_archives_end_time = parse_end_time[1];
    }

    try {
      const {data} = await Requests.getArchivesByRange(
        deviceId,
        scope,
        temp_archives_start_time,
        temp_archives_end_time,
      );
      if (data.stop === 'true') {
        if (scope == 'CloudArchives') {
          return deferred.resolve();
        } else {
          Skywatch.fetched_local_archives_done = true;
          return deferred.resolve();
        }
      } else {
        deferred.notify(data.archives);
        data.archives.forEach(archive => parseMeta(archive));
        Skywatch.archives = [...Skywatch.archives, ...data.archives];
        Skywatch._current_clould_archive_request_timer = setTimeout(function() {
          if (typeof data.next_url !== 'undefined') {
            fetchNextInterval(
              deviceId,
              scope,
              archives,
              deferred,
              false,
              false,
              data.next_url,
            );
          } else {
            fetchNextInterval(deviceId, scope, archives, deferred);
          }
        }, 1000);
        return deferred;
      }
    } catch {
      if (scope === 'CloudArchives') {
        Skywatch._current_clould_archive_request = null;
        Skywatch._current_clould_archive_request_timer = 0;
      }
    }
  };

  const onChangeTimeAndScale = function(scale, new_left_time, new_right_time) {
    const now = Math.floor(new Date().getTime() / 1000);
    $('#to_next').attr('disabled', now < new_right_time);
    $('#to_previous').attr(
      'disabled',
      now - scale_table.get('month', now) > new_left_time,
    );
    renderScaleIndicator(scale, new_left_time, new_right_time);
  };

  const renderScaleIndicator = function(
    newScale,
    new_left_time,
    new_right_time,
  ) {
    const new_scale = newScale || scale;
    const left_time = new_left_time || leftTimestamp;
    const right_time = new_right_time || rightTimestamp;

    let time_width = 24 * 60 * 60;
    if (new_scale == 'hour') {
      time_width = 10 * 60;
    } else if (new_scale == 'day') {
      time_width = 2 * 60 * 60;
    } else {
      time_width = 24 * 60 * 60;
    }

    // shade
    const start_time = left_time;
    const end_time = right_time;

    let content = '';
    let label = '';
    let width = (time_width / (end_time - start_time)) * 100;
    let left = 0;
    let time = start_time;
    let date;
    let month, day, hour, min;
    let offset = new Date().getTimezoneOffset();
    let i = 0;
    while (time < end_time) {
      content += '<div class="';
      content += 'shade ';
      if (new_scale == 'hour' || new_scale == 'day') {
        content += 'shade-grid';
      } else {
        if (Math.floor((time - offset * 60) / (24 * 60 * 60)) % 2 === 1) {
          content += 'shade-light';
        } else {
          content += 'shade-dark';
        }
      }

      content += '" style="width:' + width + '%;left:' + left + '%;"></div>';
      // calculate label
      date = new Date(parseInt(time) * 1000);
      if (i > 0) {
        // 1 label/ 2 days when month mode
        if (!(new_scale == 'month' && date.getDate() % 2 === 1)) {
          label += '<span class="time_label" style="left:' + left + '%;">';
          if (new_scale == 'month' || new_scale == 'week') {
            month = date.getMonth() + 1;
            day = date.getDate();
            if (month < 10) month = '0' + month;
            if (day < 10) day = '0' + day;
            label += month + '/' + day;
          } else {
            hour = date.getHours();
            min = date.getMinutes();
            if (hour < 10) hour = '0' + hour;
            if (min < 10) min = '0' + min;
            label += hour + ':' + min;
          }
          label += '</span>';
        }
      }

      left += width;
      time += time_width;
      i++;
    }
    $('#shades').html(content);
    $('#label_content').html(label);
    $('#timeline_container')
      .children()
      .css('opacity', 1);
  };

  const getTimestampByPosition = position => {
    const time_position = position - $('#timebar_content').offset().left;
    const timebar_width = $('#timebar_content').width();
    return parseInt(
      (time_position / timebar_width) * (rightTimestamp - leftTimestamp) +
        leftTimestamp,
      10,
    );
  };

  const handleTimebarContentClicked = e => {
    setLoading(true);
    let timestamp = getTimestampByPosition(e.pageX);
    const now = Math.ceil(new Date().getTime() / 1000);
    if (timestamp > now) {
      timestamp = now;
    }
    seek(timestamp);
  };

  const onPreviousClick = function(e) {
    var start_time = getScaleStartTime(leftTimestamp - 100, scale);
    var right_time = start_time + scale_table.get(scale, start_time);
    updateTimebar(leftTimestamp, rightTimestamp, start_time, right_time);
    setLeftTimestamp(start_time);
    setRightTimestamp(right_time);
  };

  const onNextClick = function() {
    var start_time = getScaleStartTime(rightTimestamp + 100, scale);
    var right_time = start_time + scale_table.get(scale, start_time);
    updateTimebar(leftTimestamp, rightTimestamp, start_time, right_time);
    setLeftTimestamp(start_time);
    setRightTimestamp(right_time);
  };

  const updateTimebar = (
    old_left_time,
    old_right_time,
    new_left_time,
    new_right_time,
  ) => {
    // update display
    const obj = {'#date_left': new_left_time, '#date_right': new_right_time};
    Object.keys(obj).forEach(selector => {
      const date_data = getTimeData(obj[selector]);
      $(
        $(selector)
          .find('span')
          .get(0),
      ).html(date_data.date_display);
      $(
        $(selector)
          .find('span')
          .get(1),
      ).html(date_data.hour_time_display);
    });

    // calculate animation

    const animate_time = 500;

    let timeline_animation = false;
    let timeline_child_animation = false;
    let cursor_animation = false;
    let played_animation = false;
    let shift;
    let distance;

    let bubble_animation = false;
    let bubble_animate_time = animate_time;

    // calculate element delay
    let element_delay = false;
    let element_animation_time = animate_time;
    if (old_left_time !== 0 && old_right_time !== 0) {
      if (
        (old_left_time < new_left_time && old_right_time < new_right_time) ||
        (old_left_time > new_left_time && old_right_time > new_right_time)
      ) {
        if (
          !(currentTime >= old_left_time && currentTime <= old_right_time) &&
          currentTime >= new_left_time &&
          currentTime <= new_right_time
        ) {
          if (old_left_time < new_left_time) {
            element_delay =
              (animate_time * (currentTime - new_left_time)) /
              (new_right_time - new_left_time);
            element_animation_time =
              (animate_time * (new_right_time - currentTime)) /
              (new_right_time - new_left_time);
          } else {
            element_delay =
              (animate_time * (new_right_time - currentTime)) /
              (new_right_time - new_left_time);
            element_animation_time =
              (animate_time * (currentTime - new_left_time)) /
              (new_right_time - new_left_time);
          }
        }
      }
    }

    // ignore initial
    if (old_left_time !== 0 && old_right_time !== 0) {
      if (
        (old_left_time < new_left_time && old_right_time < new_right_time) ||
        (old_left_time > new_left_time && old_right_time > new_right_time)
      ) {
        // shifts
        if (old_left_time < new_left_time) {
          shift = '-=';
        } else {
          shift = '+=';
        }

        timeline_animation = {
          left: shift + '100%',
        };

        // animate out
        if (currentTime >= old_left_time && currentTime <= old_right_time) {
          // calculate distance
          if (shift == '-=') {
            distance =
              ((currentTime - old_left_time) /
                (old_right_time - old_left_time)) *
              $('#timebar_content').width();
            bubble_animate_time =
              (bubble_animate_time * (currentTime - old_left_time)) /
              (old_right_time - old_left_time);
          } else {
            distance =
              ((old_right_time - currentTime) /
                (old_right_time - old_left_time)) *
              $('#timebar_content').width();
            bubble_animate_time =
              (bubble_animate_time * (old_right_time - currentTime)) /
              (old_right_time - old_left_time);
          }
          bubble_animation = {
            left: shift + distance,
          };
        } else if (
          currentTime >= new_left_time &&
          currentTime <= new_right_time
        ) {
          // animate in
          if (shift == '-=') {
            distance =
              ((new_right_time - currentTime) /
                (new_right_time - new_left_time)) *
                $('#timebar_content').width() +
              28;
            bubble_animate_time =
              (animate_time * (new_right_time - currentTime)) /
              (new_right_time - new_left_time);
          } else {
            distance =
              ((currentTime - new_left_time) /
                (new_right_time - new_left_time)) *
              $('#timebar_content').width();
            bubble_animate_time =
              (animate_time * (currentTime - new_left_time)) /
              (new_right_time - new_left_time);
          }
          bubble_animation = {
            left: shift + distance,
          };
        }
      } else if (
        old_right_time - old_left_time !==
        new_right_time - new_left_time
      ) {
        // enlarge or reduce
        timeline_animation = {};
        var times =
          (old_right_time - old_left_time) / (new_right_time - new_left_time);
        timeline_animation.width = times * 300 + '%';
        timeline_animation.left =
          times * -100 +
          ((old_left_time - new_left_time) / (new_right_time - new_left_time)) *
            100 +
          '%';
        timeline_child_animation = {
          opacity: 0.4,
        };
      }
    }

    let show_cursor = false;
    if (currentTime >= new_left_time && currentTime <= new_right_time) {
      const offset =
        ((currentTime - new_left_time) / (new_right_time - new_left_time)) *
        $('#playbar-container').width();
      played_animation = {
        width: offset,
      };
      cursor_animation = {
        left:
          $('#timebar_content').offset().left -
          $('#controlbar_container').offset().left +
          offset,
      };
      show_cursor = true;
    } else {
      if (currentTime < new_left_time) {
        played_animation = {
          width: '-=100%',
        };
      } else {
        played_animation = {
          width: '+=100%',
        };
      }

      $('#cursor').hide();
    }

    var animations = [];

    if (timeline_animation !== false) {
      animations.push(
        $('#timeline_container').animate(timeline_animation, animate_time, () =>
          // TODO (HACK): reset position after animation completed
          $('#timeline_container').css('left', '-100%'),
        ),
      );
    }
    if (bubble_animation !== false) {
      if (element_delay !== false) {
        animations.push(
          $('#cursor_bubble')
            .delay(element_delay)
            .animate(bubble_animation, element_animation_time, () =>
              setBubbleTime(currentTime, $('#cursor_bubble'), true),
            ),
        );
      } else {
        animations.push(
          $('#cursor_bubble').animate(
            bubble_animation,
            element_animation_time,
            () => setBubbleTime(currentTime, $('#cursor_bubble'), true),
          ),
        );
      }
    }
    if (timeline_child_animation !== false) {
      animations.push(
        $('#timeline_container')
          .children()
          .animate(timeline_child_animation, animate_time),
      );
    }
    if (cursor_animation !== false) {
      if (element_delay !== false) {
        animations.push(
          $('#cursor')
            .delay(element_delay)
            .animate(cursor_animation, element_animation_time),
        );
      } else {
        animations.push(
          $('#cursor').animate(cursor_animation, element_animation_time),
        );
      }
    }
    if (played_animation !== false) {
      if (element_delay !== false) {
        animations.push(
          $('#played')
            .delay(element_delay)
            .animate(played_animation, element_animation_time),
        );
      } else {
        animations.push(
          $('#played').animate(played_animation, element_animation_time),
        );
      }
    }
    if (show_cursor) $('#cursor').fadeIn(80);

    Skywatch._animating = true;
    $.when.apply($, animations).done(function() {
      Skywatch._animating = false;
    });
  };

  const setBubbleTime = (timestamp, $bubble, set_cursor) => {
    const now = Math.ceil(new Date().getTime() / 1000);
    if (timestamp > now) timestamp = now;

    const offset =
      ((timestamp - leftTimestamp) / (rightTimestamp - leftTimestamp)) *
      $('#playbar-container').width();
    const $el = $('#timebar');

    if (set_cursor) $el.find('#played').css('width', offset);
    const total_offset =
      ((now - leftTimestamp) / (rightTimestamp - leftTimestamp)) *
      $('#playbar-container').width();
    if (set_cursor) $el.find('#playbar').css('width', total_offset);

    // move seek cursor
    var $cursor = $('#cursor');
    var left =
      $('#timebar_content').offset().left -
      $('#controlbar_container').offset().left +
      offset;
    if (set_cursor) $cursor.css('left', left);

    $bubble.removeClass('right');
    $bubble.removeClass('left');
    if (timestamp >= leftTimestamp && timestamp <= rightTimestamp) {
      $el.find('#cursor').show();

      const time_data = getTimeData(timestamp);
      $bubble
        .find('span')
        .first()
        .html(time_data.date_display);
      $bubble
        .find('span')
        .last()
        .html(time_data.time_display);
      $bubble.css('left', left - 28);
    } else {
      $('#cursor').hide();
      const time_data = getTimeData(timestamp);

      if (timestamp < leftTimestamp) {
        $bubble
          .find('span')
          .first()
          .html(time_data.date_display);
        $bubble
          .find('span')
          .last()
          .html(time_data.time_display);
        $bubble.css(
          'left',
          $('#timebar_content').offset().left -
            $('#timebar').offset().left -
            20,
        );
        $bubble.addClass('left');
      } else if (timestamp > rightTimestamp) {
        $bubble
          .find('span')
          .first()
          .html(time_data.date_display);
        $bubble
          .find('span')
          .last()
          .html(time_data.time_display);
        $bubble.css(
          'left',
          $('#timebar_content').width() +
            $('#timebar_content').offset().left -
            $('#timebar_container').offset().left -
            111,
        );
        $bubble.addClass('right');
      }
    }
  };

  const handleMouseMove = e => {
    const timestamp = getTimestampByPosition(e.pageX);
    const $bubble = $('#cursor_bubble_preview');
    const date_data = getTimeData(timestamp);
    $bubble
      .find('span')
      .first()
      .html(date_data.date_display);
    $bubble
      .find('span')
      .last()
      .html(date_data.time_display);
    setBubbleTime(timestamp, $bubble, false);
    $bubble.addClass('active');
    $bubble.show();
    $('#cursor_bubble').hide();
  };

  const handleMouseOut = () => {
    const $bubble = $('#cursor_bubble_preview');
    $bubble.removeClass('active');
    $bubble.hide();
    $('#cursor_bubble').show();
  };

  const getSmartFFTimestamp = function(video_time) {
    let meta;
    try {
      meta = JSON.parse(archive.meta);
    } catch (e) {
      console.warn('json error', archive.meta);
      return 0;
    }
    let ff_second, ff_second_next;
    const meta_keys = Object.keys(meta);
    let time = false;

    for (var i = 0; i < meta_keys.length - 1; i++) {
      ff_second = parseFloat(meta[meta_keys[i]][0]);
      ff_second_next = parseFloat(meta[meta_keys[i + 1]][0]);
      if (ff_second <= video_time && ff_second_next >= video_time) {
        time =
          ((video_time - ff_second) / (ff_second_next - ff_second)) *
            (parseInt(meta_keys[i + 1], 10) - parseInt(meta_keys[i], 10)) +
          parseInt(meta_keys[i], 10);
      }
    }
    const timestamp = parseInt(archive.timestamp, 10) + Math.floor(time);
    return timestamp;
  };

  const getMetaList = function(time_i_width, left_time, right_time) {
    let i = false;
    let scale_arr = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240];
    let all_dataset = Skywatch.all_dataset;
    let is_nvr_camera = false;
    // if (this.get('model_id') == '61') {
    //   is_nvr_camera = true;
    //   scale_arr = this._local_archives.scale_arr;
    //   all_dataset = this._local_archives.all_dataset;
    // }
    let scale = scale_arr[scale_arr.length - 1]; // deafult use the largest
    for (i = 0; i < scale_arr.length; i++) {
      if (time_i_width < scale_arr[i]) {
        scale = scale_arr[i];
        break;
      }
    }

    if (typeof all_dataset['' + scale] === 'undefined') {
      return [];
    }

    let meta_list = [];
    let timebar_width = right_time - left_time;
    let data, index;
    const now = Math.floor(new Date().getTime() / 1000);
    for (i = 0; i * time_i_width < timebar_width; i++) {
      if (left_time + i * time_i_width >= now) break;
      index = '' + Math.floor((left_time + i * time_i_width) / scale) * scale;

      data = {
        start: left_time + i * time_i_width,
        end: left_time + (i + 1) * time_i_width,
      };
      if (typeof all_dataset['' + scale][index] === 'undefined') {
        data.meta = false;
        // check whether is cache time
        // NVR camera use local archives, can not fetchCacheTime
        if (is_nvr_camera) {
          data.meta = 1;
        } else {
          if (cacheTime !== 0 && data.start >= cacheTime) {
            data.meta = 1;
          }
        }
      } else {
        data.meta = all_dataset['' + scale][index];
      }
      meta_list.push(data);
    }
    return meta_list;
  };

  const getTimelineBlockMetric = (start, end, left_time, right_time) => ({
    left: ((start - left_time) / (right_time - left_time)) * 100,
    width: ((end - start) / (right_time - left_time)) * 100,
  });

  const getMetaTimebar = function(scale, start_time) {
    // render 3 views for animation to use
    const timebar_width_i = $('#timebar_content').width();
    const timebar_width = timebar_width_i * 3;
    const time_width_i = scale_table.get(scale, start_time);
    const time_width = time_width_i * 3;
    const left_time = start_time - time_width_i;
    const right_time = start_time + time_width_i * 2;

    const meta_width = 5;
    const meta_count = Math.floor(timebar_width / meta_width);

    const seconds_in_bar = time_width / meta_count;

    // use each although there should be only one camera_view
    let meta_list = [];
    let timeline_block_html = '';

    meta_list = getMetaList(seconds_in_bar, left_time, right_time);
    let i, interval, metric;

    if (meta_list.length > 0) {
      timeline_block_html += '<div class="camera-' + deviceId + '">';
      for (i = 0; i < meta_list.length; i++) {
        interval = meta_list[i];
        const {start, end, meta} = interval;
        metric = getTimelineBlockMetric(start, end, left_time, right_time);
        const isHighlightRange = start >= highlightStart && end <= highlightEnd;

        timeline_block_html += `<div class="meta_timeline_i ${
          isHighlightRange ? 'highlight' : ''
        }" start="${start}" end="${end}" style="width:4px; bottom:0; height: ${
          meta === false ? 0 : (meta * 40) / 100 + 5
        }px; left: ${metric.left}%;"></div>`;
      }
      timeline_block_html += '</div>';
    }

    return {
      html: timeline_block_html,
      timebar_width: timebar_width,
    };
  };

  const parseMeta = function(archive) {
    const scale_arr = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240];
    let scale, second, meta_data, tmp_meta, timestamp, length, meta, index;
    // fake meta data for non-smart-ff file
    const default_meta = {
      '0': [false, 1],
      '20': [false, 1],
      '40': [false, 1],
      '60': [false, 1],
      '80': [false, 1],
      '100': [false, 1],
      '120': [false, 1],
      '140': [false, 1],
      '160': [false, 1],
      '180': [false, 1],
      '200': [false, 1],
      '220': [false, 1],
      '240': [false, 1],
      '260': [false, 1],
      '280': [false, 1],
      '300': [false, 1],
      '320': [false, 1],
      '340': [false, 1],
      '360': [false, 1],
      '380': [false, 1],
      '400': [false, 1],
      '420': [false, 1],
      '440': [false, 1],
      '460': [false, 1],
      '480': [false, 1],
      '500': [false, 1],
      '520': [false, 1],
      '540': [false, 1],
      '560': [false, 1],
      '580': [false, 1],
      '600': [false, 1],
    };

    timestamp = parseInt(archive.timestamp);
    if (
      typeof archive.length === 'undefined'
      // &&
      // this._camera.get('model_id') == '61'
    ) {
      length = 60;
    } else {
      length = parseInt(archive.length);
    }

    tmp_meta = false;
    meta_data = false;
    if (length <= 20) return;

    if (!archive.smart_ff || archive.smart_ff === '0') {
      // use zero as meta
      meta = default_meta;
    } else {
      try {
        meta = JSON.parse(archive.meta);
      } catch (e) {
        console.error('Parse json meta data error');
        console.error(archive.meta);
        return;
      }

      /**
       *  Shift min to 1 to seperate no data case
       */
      for (let i in meta) {
        meta[i][1]++;
      }
    }

    for (let j = 0; j < scale_arr.length; j++) {
      scale = scale_arr[j];
      if (typeof Skywatch.all_dataset['' + scale] === 'undefined') {
        Skywatch.all_dataset['' + scale] = {};
      }
      if (meta_data === false) {
        meta_data = {};
        /**
         *   Drop meta that exceed length
         */
        for (let k = 0; k < length; k += 20) {
          index = '' + Math.floor((k + timestamp) / scale) * scale;
          if (meta['' + k]) {
            meta_data[index] = meta['' + k][1];
          } else {
            meta_data[index] = 0; //default_meta[""+k][1];
          }
        }
      }
      tmp_meta = {};
      for (second in meta_data) {
        index = '' + Math.floor(parseInt(second) / scale) * scale;
        if (typeof Skywatch.all_dataset[scale][index] == 'undefined') {
          Skywatch.all_dataset[scale][index] = meta_data[second];
          tmp_meta[index] = meta_data[second];
        } else {
          if (Skywatch.all_dataset[scale][index] < meta_data[second]) {
            Skywatch.all_dataset[scale][index] = meta_data[second];
            tmp_meta[index] = meta_data[second];
          }
        }
      }
      meta_data = tmp_meta;
    }
  };

  const onHighlightTimeChange = function(highlight_start, highlight_end) {
    $('#meta_container')
      .find('.camera-' + deviceId + ' .meta_timeline_i')
      .each(function() {
        const $el = $(this);
        if (
          parseInt($el.attr('start')) >= highlight_start &&
          parseInt($el.attr('end')) <= highlight_end
        ) {
          $el.addClass('highlight');
        } else {
          $el.removeClass('highlight');
        }
      });
    sethigHlightStart(highlight_start);
    sethigHlightEnd(highlight_end);
  };

  const updateCurrentTime = function(timestamp) {
    const current_time = isLive
      ? Math.floor(new Date().getTime() / 1000)
      : currentTime + 1;
    timestamp = timestamp || current_time;
    if (!controls) {
      setCurrentTime(timestamp);
      return;
    }
    let params = {
      current_time: timestamp,
    };

    if (
      leftTimestamp <= current_time &&
      rightTimestamp <= current_time &&
      timestamp > rightTimestamp
    ) {
      params.right_time = getScaleStartTime(rightTimestamp + 10, scale);
      params.left_time =
        params.right_time - scale_table.get(scale, rightTimestamp + 10);

      if (rightTimestamp + 1 === Math.floor(current_time)) {
        setTimeout(function() {
          onNextClick();
        }, 100);
      }
    }

    if (
      (leftTimestamp <= current_time && rightTimestamp <= current_time) ||
      (leftTimestamp >= current_time && rightTimestamp >= current_time)
    ) {
      setBubbleTime(current_time, $('#cursor_bubble'), true);
    }

    setCurrentTime(timestamp);
    if (params.left_time) setLeftTimestamp(leftTimestamp);
    if (params.right_time) setRightTimestamp(rightTimestamp);
  };

  const updateMeta = function() {
    const $meta_container = $('#meta_container');
    $meta_container.empty();

    const view_info = getMetaTimebar(scale, leftTimestamp);
    const html = view_info.html;

    $meta_container.html(html);
    $meta_container.css('left', '0');
    $meta_container.css('width', '100%');
  };

  const onChangeCurrentTime = function(current_time) {
    if (dragging) return;
    setBubbleTime(current_time, $('#cursor_bubble'), true);
  };

  const toArchiveTime = function(archive, unix_time, is_smart_ff) {
    const video_time = Math.floor(unix_time - archive.timestamp);
    if (!is_smart_ff) {
      // normal archive: global time - start time
      return video_time;
    }

    let meta;
    try {
      meta = JSON.parse(archive.meta);
    } catch (e) {
      console.warn('json error', archive.meta);
      return 0;
    }
    const meta_keys = Object.keys(meta);
    let time = 0;

    for (let i = 0; i < meta_keys.length - 1; i++) {
      if (!(meta_keys[i] <= video_time && video_time <= meta_keys[i + 1])) {
        continue;
      }
      time = meta[meta_keys[i]][0];
      break;
    }
    return Math.floor(time);
  };

  const onVideoEnded = function() {
    const data = getNextCloudArchive(archive, smart_ff);
    if (data.status === STATUS_END) {
      console.info('no archive');
      setArchive(null);
      Skywatch.next_archive = null;
      goLive();
    } else if (data.status === STATUS_HOLE) {
      // when there is a gap between the 2 archives
      console.info('player.hole');
      Skywatch.next_archive = data.archive;
      onPlayerHole();
    } else if (data.status === STATUS_OK) {
      console.info('player.ok');
      setLoading(true);
      setArchive(data.archive);
      setArchiveCounter(prev => prev + 1);
      setSeekTime(0);
      Skywatch.next_archive = null;
      onHighlightTimeChange(
        parseInt(data.archive.timestamp),
        parseInt(data.archive.timestamp) + parseInt(data.archive.length),
      );
    }
  };

  const onTimeUpdate = () => {
    const video_time = player.currentTime();
    if (smart_ff) {
      // smart ff need to update timestamp frequently
      if (Skywatch.tick_counter === 0) {
        // video timestamp will not immediately update to seeked time
        // so we need to filter out 0
        if (video_time !== 0 && !loading) {
          updateCurrentTime(getSmartFFTimestamp(video_time));
        }
      }
      // report every 1 seconds
      Skywatch.tick_counter = (Skywatch.tick_counter + 1) % 4;
    } else {
      if (Skywatch.tick_counter === 0) {
        const normalTimestamp =
          parseInt(archive.timestamp, 10) + Math.floor(video_time);
        if (Math.abs(normalTimestamp - currentTime) >= 10) {
          // TODO: sync cursor or sync video?
          updateCurrentTime(normalTimestamp);
        }
      }
      // report every 5 seconds
      Skywatch.tick_counter = (Skywatch.tick_counter + 1) % (4 * 5);
    }
  };

  const onPlayerHole = function() {
    const edge = getNextEdge();
    if (edge > 0) {
      seek(edge);
    }
  };

  const getNextEdge = function() {
    return Skywatch.next_archive ? Skywatch.next_archive.timestamp * 1 : 0;
  };

  const getNextCloudArchive = function(archive, smart_ff) {
    Skywatch.archives = Skywatch.archives.sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    let i = Skywatch.archives.findIndex(a => a.id === archive.id);
    let next_archive;
    let status = STATUS_OK;
    while (true) {
      ++i;
      next_archive = Skywatch.archives[i];
      // invalid
      if (!next_archive) {
        status = STATUS_END;
        break;
      }
      // valid && CR && smart_ff
      if (
        next_archive &&
        next_archive.event_type === '10' &&
        (!smart_ff || next_archive.smart_ff === '1')
      ) {
        break;
      }
    }
    const {timestamp, length} = archive;
    if (
      next_archive &&
      next_archive.timestamp - (timestamp * 1 + length * 1) >= 3
    ) {
      status = STATUS_HOLE;
    }
    return {
      status: status,
      archive: next_archive,
    };
  };

  const play = e => {
    if (controls) {
      resetActiveButton();
      e.target.parentElement.classList.add('active');
      setDelay(1000);
    }
    setSmart_ff(0);
    if (isLive) {
      goLive();
    } else if (smart_ff) {
      seek(getSmartFFTimestamp(player.currentTime()), false);
    } else {
      player && player.play();
    }
  };
  const pause = e => {
    if (controls) {
      resetActiveButton();
      e.target.parentElement.classList.add('active');
      setDelay(null);
    }
    player && player.pause();
  };
  const fastForward = e => {
    if (!smart_ff) {
      if (controls) {
        setDelay(null);
        resetActiveButton();
        e.target.parentElement.classList.add('active');
      }
      if (isLive) {
        goLive();
        return;
      }
      setLoading(true);
      setSmart_ff(1);
      setSeekTime(toArchiveTime(archive, currentTime, true));
      setArchiveCounter(prev => prev + 1);
    }
  };
  const toggleMute = () => {
    if (isLive && player) {
      // flvjs
      player.muted = !isMuted;
    } else {
      // videojs
      player && player.muted(!isMuted);
    }
    setIsMuted(!isMuted);
  };

  const onMouseDown = () => {
    setDragging(true);
  };

  const onMouseMove = e => {
    if (!dragging) return;
    const containment = $('#playbar');
    const time_position = e.pageX - containment.offset().left;
    $('#played').css('width', time_position);
    const timestamp = getTimestampByPosition(e.pageX);

    if (
      timestamp > Math.ceil(new Date().getTime() / 1000) &&
      Skywatch.last_timestamp !== false &&
      timestamp > Skywatch.last_timestamp
    ) {
      return false;
    }
    Skywatch.last_timestamp = timestamp;
    setBubbleTime(timestamp, $('#cursor_bubble'), true);
  };

  const onMouseUp = e => {
    if (dragging) {
      handleTimebarContentClicked(e);
      setDragging(false);
    }
  };

  const onFocus = () => {
    if (!smart_ff) setDelay(1000);
    isLive ? goLive() : seek(currentTime);
  };
  const onBlur = () => {
    setDelay(null);
  };

  return (
    <>
      <div
        id="group-view-camera"
        // mouse event listeners for handling draggable cursor
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}>
        <div id="camera-grid-container">
          {loading && renderLoading()}
          {isVisible &&
            (isLive ? (
              <FlvPlayer
                key={flvCounter}
                deviceId={deviceId}
                onPlayerInit={setPlayer}
                onPlayerDispose={setPlayer}
                style={{width: '768px', height: '432px'}}
                onReady={() => setLoading(false)}
                controls={false}
              />
            ) : (
              <ArchivesPlayer
                key={archiveCounter}
                onPlayerInit={setPlayer}
                onPlayerDispose={setPlayer}
                deviceId={deviceId}
                archiveId={archive.id}
                smart_ff={smart_ff}
                seek={seekTime}
                style={{width: '768px', height: '432px'}}
                controls={false}
                onEnded={onVideoEnded}
                onReady={() => setLoading(false)}
                onTimeUpdate={onTimeUpdate}
              />
            ))}
        </div>

        {controls && (
          <>
            <div id="buffer_container"></div>
            <div id="controlbar_container" style={{height: 140}}>
              <div id="controlbar">
                <div id="cursor_bubble">
                  <span id="bubble_date"></span>
                  <span id="bubble_time"></span>
                </div>
                <div
                  id="cursor_bubble_preview"
                  onMouseMove={handleMouseMove}
                  onMouseOut={handleMouseOut}>
                  <span id="bubble_date"></span>
                  <span id="bubble_time"></span>
                </div>
                <div id="timebar_container">
                  <div id="timebar">
                    <div className="left_button">
                      <div
                        className="btn btn-default"
                        id="to_previous"
                        onClick={onPreviousClick}></div>
                    </div>
                    <div
                      id="timebar_content"
                      onClick={handleTimebarContentClicked}
                      onMouseMove={handleMouseMove}
                      onMouseOut={handleMouseOut}>
                      <div id="timeline_container" className="loading">
                        <div id="scale_container">
                          <div id="shades">
                            <div className="shade shade-light"></div>
                          </div>
                          <div id="grids"></div>
                        </div>
                        <div id="meta_container"></div>
                      </div>
                      <div id="playbar-container">
                        <div id="playbar"></div>
                        <div id="played"></div>
                      </div>
                    </div>
                    <div
                      id="cursor"
                      onMouseDown={onMouseDown}
                      className={isLive ? 'live' : ''}>
                      <div id="cursor_clickable"></div>
                    </div>
                    <div className="right_button">
                      <div
                        className="btn btn-default"
                        id="to_next"
                        disabled
                        onClick={onNextClick}></div>
                    </div>
                  </div>
                </div>
                <div id="label_container">
                  <div id="label_content"></div>
                </div>
                <div id="controlbar_content">
                  <div id="date_left">
                    <div>
                      <span>{getTimeData(leftTimestamp).date_display}</span>
                      <span>{getTimeData(leftTimestamp).time_display}</span>
                    </div>
                  </div>
                  <div className="button_group_container">
                    <div className="button_group playback-control-group">
                      <div className="control_button" onClick={pause}>
                        <div id="control-pause"></div>
                      </div>
                      <div className="control_button active" onClick={play}>
                        <div id="control-play"></div>
                      </div>
                      {!hide_ff && (
                        <div className="control_button" onClick={fastForward}>
                          <div id="control-fastforward"></div>
                        </div>
                      )}
                    </div>
                    <div className="button_group">
                      <div
                        className={`switch_button ${isMuted ? 'active' : ''}`}
                        onClick={toggleMute}>
                        <div id="control-volume"></div>
                      </div>

                      <div
                        className={`switch_button button_long ${
                          isLive ? 'active' : ''
                        }`}>
                        <div id="control-golive" onClick={goLive}></div>
                      </div>
                    </div>
                    <div className="button_group pull-right">
                      <div
                        className="control_button active"
                        onClick={onScaleClick}>
                        <div id="control-hour">{'時'}</div>
                      </div>
                      <div className="control_button" onClick={onScaleClick}>
                        <div id="control-day">{'日'}</div>
                      </div>
                      <div className="control_button" onClick={onScaleClick}>
                        <div id="control-week">{'週'}</div>
                      </div>
                      <div className="control_button" onClick={onScaleClick}>
                        <div id="control-month">{'月'}</div>
                      </div>
                    </div>
                  </div>
                  <div id="date_right">
                    <div>
                      <span>{getTimeData(rightTimestamp).date_display}</span>
                      <span>{getTimeData(rightTimestamp).time_display}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
});

CameraView.defaultProps = {
  renderLoading: () => <div style={loadingStyle}></div>,
  controls: true,
};

CameraView.propTypes = {
  deviceId: PropTypes.string.isRequired,
  renderLoading: PropTypes.func,
  controls: PropTypes.bool,
};
export default CameraView;
