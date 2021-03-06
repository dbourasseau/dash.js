/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
Dash.dependencies.DashHandler = function () {
    "use strict";

    var index = -1,
        requestedTime,
        isDynamic,
        type,
        currentTime = 0,
        absUrl = new RegExp('^(?:(?:[a-z]+:)?\/)?\/', 'i'),

        zeroPadToLength = function (numStr, minStrLength) {
            while (numStr.length < minStrLength) {
                numStr = "0" + numStr;
            }

            return numStr;
        },

        replaceTokenForTemplate = function (url, token, value) {

            var startPos,
                endPos,
                tokenLen = token.length,
                formatTag = "%0",
                formatTagLen = formatTag.length,
                formatTagPos,
                specifier,
                width,
                paddedValue;

            // keep looping round until all instances of <token> have been
            // replaced. once that has happened, startPos below will be -1
            // and the completed url will be returned.
            while (true) {

                // check if there is a valid $<token>...$ identifier
                // if not, return the url as is.
                startPos = url.indexOf("$" + token);
                if (startPos < 0) {
                    return url;
                }

                // the next '$' must be the end of the identifier
                // if there isn't one, return the url as is.
                endPos = url.indexOf("$", startPos + tokenLen);
                if (endPos < 0) {
                    return url;
                }

                // now see if there is an additional format tag suffixed to
                // the identifier within the enclosing '$' characters
                formatTagPos = url.indexOf(formatTag, startPos + tokenLen);
                if (formatTagPos > startPos && formatTagPos < endPos) {

                    specifier = url.charAt(endPos - 1);
                    width = parseInt(url.substring(formatTagPos + formatTagLen, endPos - 1), 10);

                    // support the minimum specifiers required by IEEE 1003.1
                    // (d, i , o, u, x, and X) for completeness
                    switch (specifier) {
                    // treat all int types as uint,
                    // hence deliberate fallthrough
                    case 'd':
                    case 'i':
                    case 'u':
                        paddedValue = zeroPadToLength(value.toString(), width);
                        break;
                    case 'x':
                        paddedValue = zeroPadToLength(value.toString(16), width);
                        break;
                    case 'X':
                        paddedValue = zeroPadToLength(value.toString(16), width).toUpperCase();
                        break;
                    case 'o':
                        paddedValue = zeroPadToLength(value.toString(8), width);
                        break;
                    default:
                        this.log("Unsupported/invalid IEEE 1003.1 format identifier string in URL");
                        return url;
                    }
                } else {
                    paddedValue = value;
                }

                url = url.substring(0, startPos) + paddedValue + url.substring(endPos + 1);
            }
        },

        unescapeDollarsInTemplate = function (url) {
            return url.split("$$").join("$");
        },

        replaceIDForTemplate = function (url, value) {
            if (value === null || url.indexOf("$RepresentationID$") === -1) { return url; }
            var v = value.toString();
            return url.split("$RepresentationID$").join(v);
        },

        getNumberForSegment = function(segment, segmentIndex) {
            return segment.representation.startNumber + segmentIndex;
        },

        getRequestUrl = function (destination, representation) {
            var baseURL = representation.adaptation.period.mpd.manifest.Period_asArray[representation.adaptation.period.index].
                    AdaptationSet_asArray[representation.adaptation.index].Representation_asArray[representation.index].BaseURL,
                url;

            if (destination === baseURL) {
                url = destination;
            } else if (absUrl.test(destination)) {
                url = destination;
            } else {
                url = baseURL + destination;
            }

            return url;
        },

        generateInitRequest = function(representation, mediaType) {
            var self = this,
                period,
                request = new MediaPlayer.vo.FragmentRequest(),
                presentationStartTime;

            period = representation.adaptation.period;

            request.mediaType = mediaType;
            request.type = MediaPlayer.vo.metrics.HTTPRequest.INIT_SEGMENT_TYPE;
            request.url = getRequestUrl(representation.initialization, representation);
            request.range = representation.range;
            presentationStartTime = period.start;
            request.availabilityStartTime = self.timelineConverter.calcAvailabilityStartTimeFromPresentationTime(presentationStartTime, representation.adaptation.period.mpd, isDynamic);
            request.availabilityEndTime = self.timelineConverter.calcAvailabilityEndTimeFromPresentationTime(presentationStartTime + period.duration, period.mpd, isDynamic);
            request.quality = representation.index;
            request.mediaInfo = self.streamProcessor.getMediaInfo();

            return request;
        },

        getInit = function (representation) {
            var self = this,
                request;

            if (!representation) return null;

            request = generateInitRequest.call(self, representation, type);
            //self.log("Got an initialization.");

            return request;
        },

        isMediaFinished = function (representation) { // TODO
            var sDuration,
                period = representation.adaptation.period,
                isFinished = false,
                seg,
                segmentInfoType = representation.segmentInfoType,
                fTime;

            if (index < 0) {
                isFinished = false;
            } else if (isDynamic || index < representation.availableSegmentsNumber) {
                seg = getSegmentByIndex(index, representation);

                if (seg) {
                    fTime = seg.presentationStartTime - period.start;
                    sDuration = representation.adaptation.period.duration;
                    this.log(representation.segmentInfoType + ": " + fTime + " / " + sDuration);
                    isFinished = segmentInfoType === "SegmentTimeline" ? false : (fTime >= sDuration);
                }
            } else {
                isFinished = true;
            }

            return isFinished;
        },

        getIndexBasedSegment = function (representation, index) {
            var self = this,
                seg,
                duration,
                presentationStartTime,
                presentationEndTime;

            duration = representation.segmentDuration;

            /*
             * From spec - If neither @duration attribute nor SegmentTimeline element is present, then the Representation 
             * shall contain exactly one Media Segment. The MPD start time is 0 and the MPD duration is obtained 
             * in the same way as for the last Media Segment in the Representation.
             */
            if (isNaN(duration)) {
                duration = representation.adaptation.period.duration;
            }

            presentationStartTime = representation.adaptation.period.start + (index * duration);
            presentationEndTime = presentationStartTime + duration;

            seg = new Dash.vo.Segment();

            seg.representation = representation;
            seg.duration = duration;
            seg.presentationStartTime = presentationStartTime;

            seg.mediaStartTime = self.timelineConverter.calcMediaTimeFromPresentationTime(seg.presentationStartTime, representation);

            seg.availabilityStartTime = self.timelineConverter.calcAvailabilityStartTimeFromPresentationTime(seg.presentationStartTime, representation.adaptation.period.mpd, isDynamic);
            seg.availabilityEndTime = self.timelineConverter.calcAvailabilityEndTimeFromPresentationTime(presentationEndTime, representation.adaptation.period.mpd, isDynamic);

            // at this wall clock time, the video element currentTime should be seg.presentationStartTime
            seg.wallStartTime = self.timelineConverter.calcWallTimeForSegment(seg, isDynamic);

            seg.replacementNumber = getNumberForSegment(seg, index);
            seg.availabilityIdx = index;

            return seg;
        },

        getSegmentsFromTimeline = function (representation) {
            var self = this,
                template = representation.adaptation.period.mpd.manifest.Period_asArray[representation.adaptation.period.index].
                    AdaptationSet_asArray[representation.adaptation.index].Representation_asArray[representation.index].SegmentTemplate,
                timeline = template.SegmentTimeline,
                isAvailableSegmentNumberCalculated = representation.availableSegmentsNumber > 0,
                maxSegmentsAhead = 10,
                segments = [],
                fragments,
                frag,
                i,
                len,
                j,
                repeat,
                repeatEndTime,
                nextFrag,
                time = 0,
                scaledTime = 0,
                availabilityIdx = -1,
                calculatedRange,
                hasEnoughSegments,
                requiredMediaTime,
                isStartSegmentForRequestedTimeFound = false,
                startIdx,
                endIdx,
                fTimescale,
                createSegment = function(s) {
                    return getTimeBasedSegment.call(
                        self,
                        representation,
                        time,
                        s.d,
                        fTimescale,
                        template.media,
                        s.mediaRange,
                        availabilityIdx);
                };

            fTimescale = representation.timescale;

            fragments = timeline.S_asArray;

            calculatedRange = decideSegmentListRangeForTimeline.call(self, representation);

            // if calculatedRange exists we should generate segments that belong to this range.
            // Otherwise generate maxSegmentsAhead segments ahead of the requested time
            if (calculatedRange) {
                startIdx = calculatedRange.start;
                endIdx = calculatedRange.end;
            } else {
                requiredMediaTime = self.timelineConverter.calcMediaTimeFromPresentationTime(requestedTime || 0, representation);
            }

            for (i = 0, len = fragments.length; i < len; i += 1) {
                frag = fragments[i];
                repeat = 0;
                if (frag.hasOwnProperty("r")) {
                    repeat = frag.r;
                }

                //For a repeated S element, t belongs only to the first segment
                if (frag.hasOwnProperty("t")) {
                    time = frag.t;
                    scaledTime = time / fTimescale;
                }

                //This is a special case: "A negative value of the @r attribute of the S element indicates that the duration indicated in @d attribute repeats until the start of the next S element, the end of the Period or until the
                // next MPD update."
                if (repeat < 0) {
                    nextFrag = fragments[i+1];

                    if (nextFrag && nextFrag.hasOwnProperty("t")) {
                        repeatEndTime = nextFrag.t / fTimescale;
                    } else {
                        var availabilityEnd = representation.segmentAvailabilityRange ? representation.segmentAvailabilityRange.end : (this.timelineConverter.calcSegmentAvailabilityRange(representation, isDynamic).end);
                        repeatEndTime = self.timelineConverter.calcMediaTimeFromPresentationTime(availabilityEnd, representation);
                        representation.segmentDuration = frag.d / fTimescale;
                    }

                    repeat = Math.ceil((repeatEndTime - scaledTime)/(frag.d/fTimescale)) - 1;
                }

                // if we have enough segments in the list, but we have not calculated the total number of the segments yet we
                // should continue the loop and calc the number. Once it is calculated, we can break the loop.
                if (hasEnoughSegments) {
                    if (isAvailableSegmentNumberCalculated) break;
                    availabilityIdx += repeat + 1;
                    continue;
                }

                for (j = 0; j <= repeat; j += 1) {
                    availabilityIdx += 1;

                    if (calculatedRange) {
                        if (availabilityIdx > endIdx) {
                            hasEnoughSegments = true;
                            if (isAvailableSegmentNumberCalculated) break;
                            continue;
                        }

                        if (availabilityIdx >= startIdx) {
                            segments.push(createSegment.call(self, frag));
                        }
                    } else {
                        if (segments.length > maxSegmentsAhead) {
                            hasEnoughSegments = true;
                            if (isAvailableSegmentNumberCalculated) break;
                            continue;
                        }

                        // In some cases when requiredMediaTime = actual end time of the last segment
                        // it is possible that this time a bit exceeds the declared end time of the last segment.
                        // in this case we still need to include the last segment in the segment list. to do this we
                        // use a correction factor = 1.5. This number is used because the largest possible deviation is
                        // is 50% of segment duration.
                        if (isStartSegmentForRequestedTimeFound) {
                            segments.push(createSegment.call(self, frag));
                        }  else if (scaledTime >= (requiredMediaTime - (frag.d / fTimescale)*1.5)) {
                            isStartSegmentForRequestedTimeFound = true;
                            segments.push(createSegment.call(self, frag));
                        }
                    }

                    time += frag.d;
                    scaledTime = time / fTimescale;
                }
            }

            if (!isAvailableSegmentNumberCalculated) {
                representation.availableSegmentsNumber = availabilityIdx + 1;
            }

            return segments;
        },

        getSegmentsFromTemplate = function (representation) {
            var segments = [],
                self = this,
                template = representation.adaptation.period.mpd.manifest.Period_asArray[representation.adaptation.period.index].
                    AdaptationSet_asArray[representation.adaptation.index].Representation_asArray[representation.index].SegmentTemplate,
                duration = representation.segmentDuration,
                availabilityWindow = representation.segmentAvailabilityRange,
                segmentRange,
                periodSegIdx,
                startIdx,
                endIdx,
                seg = null,
                start,
                url = null;

            start = representation.startNumber;

            if (isNaN(duration) && !isDynamic) {
                segmentRange = {start: start, end: start};
            }
            else {
                segmentRange = decideSegmentListRangeForTemplate.call(self, representation);
            }

            startIdx = segmentRange.start;
            endIdx = segmentRange.end;

            for (periodSegIdx = startIdx;periodSegIdx <= endIdx; periodSegIdx += 1) {

                seg = getIndexBasedSegment.call(
                    self,
                    representation,
                    periodSegIdx);

                seg.replacementTime = (start + periodSegIdx - 1) * representation.segmentDuration;
                url = template.media;
                url = replaceTokenForTemplate(url, "Number", seg.replacementNumber);
                url = replaceTokenForTemplate(url, "Time", seg.replacementTime);
                seg.media = url;

                segments.push(seg);
                seg = null;
            }

            if (isNaN(duration)) {
                representation.availableSegmentsNumber = 1;
            }
            else {
                representation.availableSegmentsNumber = Math.ceil((availabilityWindow.end - availabilityWindow.start) / duration);
            }

            return segments;
        },

        decideSegmentListRangeForTemplate = function(representation) {
            var self = this,
                duration = representation.segmentDuration,
                minBufferTime = representation.adaptation.period.mpd.manifest.minBufferTime,
                availabilityWindow = representation.segmentAvailabilityRange,
                periodRelativeRange = {start: self.timelineConverter.calcPeriodRelativeTimeFromMpdRelativeTime(representation, availabilityWindow.start),
                    end: self.timelineConverter.calcPeriodRelativeTimeFromMpdRelativeTime(representation, availabilityWindow.end)},
                originAvailabilityTime = NaN,
                originSegment = null,
                currentSegmentList = representation.segments,
                availabilityLowerLimit = 2 * duration,
                availabilityUpperLimit = Math.max(2 * minBufferTime, 10 * duration),
                start,
                end,
                range;

            if (!periodRelativeRange) {
                periodRelativeRange = self.timelineConverter.calcSegmentAvailabilityRange(representation, isDynamic);
            }

            periodRelativeRange.start = Math.max(periodRelativeRange.start, 0);

            if (isDynamic && !self.timelineConverter.isTimeSyncCompleted()) {
                start = Math.floor(periodRelativeRange.start / duration);
                end = Math.floor(periodRelativeRange.end / duration);
                range = {start: start, end: end};
                return range;
            }

            // if segments exist we should try to find the latest buffered time, which is the presentation time of the
            // segment for the current index
            if (currentSegmentList && currentSegmentList.length > 0) {
                originSegment = getSegmentByIndex(index, representation);
                originAvailabilityTime = originSegment ? self.timelineConverter.calcPeriodRelativeTimeFromMpdRelativeTime(representation, originSegment.presentationStartTime) :
                    (index > 0 ? (index * duration) : self.timelineConverter.calcPeriodRelativeTimeFromMpdRelativeTime(representation, requestedTime || currentSegmentList[0].presentationStartTime));
            } else {
                // If no segments exist, but index > 0, it means that we switch to the other representation, so
                // we should proceed from this time.
                // Otherwise we should start from the beginning for static mpds or from the end (live edge) for dynamic mpds
                originAvailabilityTime = (index > 0) ? (index * duration) : (isDynamic ? periodRelativeRange.end : periodRelativeRange.start);
            }

            // segment list should not be out of the availability window range
            start = Math.floor(Math.max(originAvailabilityTime - availabilityLowerLimit, periodRelativeRange.start) / duration);
            end = Math.floor(Math.min(start + availabilityUpperLimit / duration, periodRelativeRange.end / duration));

            range = {start: start, end: end};

            return range;
        },

        decideSegmentListRangeForTimeline = function(/*representation*/) {
            var availabilityLowerLimit = 2,
                availabilityUpperLimit = 10,
                firstIdx = 0,
                lastIdx = Number.POSITIVE_INFINITY,
                start,
                end,
                range;

            if (isDynamic && !this.timelineConverter.isTimeSyncCompleted()) {
                range = {start: firstIdx, end: lastIdx};
                return range;
            }

            if((!isDynamic && requestedTime) || index < 0) return null;

            // segment list should not be out of the availability window range
            start = Math.max(index - availabilityLowerLimit, firstIdx);
            end = Math.min(index + availabilityUpperLimit, lastIdx);

            range = {start: start, end: end};

            return range;
        },

        getTimeBasedSegment = function(representation, time, duration, fTimescale, url, range, index) {
            var self = this,
                scaledTime = time / fTimescale,
                scaledDuration = Math.min(duration / fTimescale, representation.adaptation.period.mpd.maxSegmentDuration),
                presentationStartTime,
                presentationEndTime,
                seg;

            presentationStartTime = self.timelineConverter.calcPresentationTimeFromMediaTime(scaledTime, representation);
            presentationEndTime = presentationStartTime + scaledDuration;

            seg = new Dash.vo.Segment();

            seg.representation = representation;
            seg.duration = scaledDuration;
            seg.mediaStartTime = scaledTime;

            seg.presentationStartTime = presentationStartTime;

            // For SegmentTimeline every segment is available at loadedTime
            seg.availabilityStartTime = representation.adaptation.period.mpd.manifest.loadedTime;
            seg.availabilityEndTime = self.timelineConverter.calcAvailabilityEndTimeFromPresentationTime(presentationEndTime, representation.adaptation.period.mpd, isDynamic);

            // at this wall clock time, the video element currentTime should be seg.presentationStartTime
            seg.wallStartTime = self.timelineConverter.calcWallTimeForSegment(seg, isDynamic);

            seg.replacementTime = time;

            seg.replacementNumber = getNumberForSegment(seg, index);

            url = replaceTokenForTemplate(url, "Number", seg.replacementNumber);
            url = replaceTokenForTemplate(url, "Time", seg.replacementTime);
            seg.media = url;
            seg.mediaRange = range;
            seg.availabilityIdx = index;

            return seg;
        },

        getSegmentsFromList = function (representation) {
            var self = this,
                segments = [],
                list = representation.adaptation.period.mpd.manifest.Period_asArray[representation.adaptation.period.index].
                    AdaptationSet_asArray[representation.adaptation.index].Representation_asArray[representation.index].SegmentList,
                baseURL = representation.adaptation.period.mpd.manifest.Period_asArray[representation.adaptation.period.index].
                    AdaptationSet_asArray[representation.adaptation.index].Representation_asArray[representation.index].BaseURL,
                len = list.SegmentURL_asArray.length,
                periodSegIdx,
                seg,
                s,
                range,
                startIdx,
                endIdx,
                start;

            start = representation.startNumber;

            range = decideSegmentListRangeForTemplate.call(self, representation);
            startIdx = Math.max(range.start, 0);
            endIdx = Math.min(range.end, list.SegmentURL_asArray.length - 1);

            for (periodSegIdx = startIdx; periodSegIdx <= endIdx; periodSegIdx += 1) {
                s = list.SegmentURL_asArray[periodSegIdx];

                seg = getIndexBasedSegment.call(
                    self,
                    representation,
                    periodSegIdx);

                seg.replacementTime = (start + periodSegIdx - 1) * representation.segmentDuration;
                seg.media = s.media ? s.media : baseURL;
                seg.mediaRange = s.mediaRange;
                seg.index = s.index;
                seg.indexRange = s.indexRange;

                segments.push(seg);
                seg = null;
            }

            representation.availableSegmentsNumber = len;

            return segments;
        },

        getSegments = function (representation) {
            var segments,
                self = this,
                type = representation.segmentInfoType;

                // Already figure out the segments.
            if (type === "SegmentBase" || type === "BaseURL" || !isSegmentListUpdateRequired.call(self, representation)) {
                segments = representation.segments;
            } else {
                if (type === "SegmentTimeline") {
                    segments = getSegmentsFromTimeline.call(self, representation);
                } else if (type === "SegmentTemplate") {
                    segments = getSegmentsFromTemplate.call(self, representation);
                } else if (type === "SegmentList") {
                    segments = getSegmentsFromList.call(self, representation);
                }

                onSegmentListUpdated.call(self, representation, segments);
            }

            return segments;
        },

        onSegmentListUpdated = function(representation, segments) {
            var lastIdx,
                liveEdge,
                metrics,
                lastSegment;

            representation.segments = segments;
            lastIdx = segments.length - 1;
            if (isDynamic && isNaN(this.timelineConverter.getExpectedLiveEdge())) {
                lastSegment = segments[lastIdx];
                liveEdge = lastSegment.presentationStartTime;
                metrics = this.metricsModel.getMetricsFor("stream");
                // the last segment is supposed to be a live edge
                this.timelineConverter.setExpectedLiveEdge(liveEdge);
                this.metricsModel.updateManifestUpdateInfo(this.metricsExt.getCurrentManifestUpdate(metrics), {presentationStartTime: liveEdge});
            }
        },

        updateSegmentList = function(representation) {
            var self = this;

            if (!representation) {
                throw new Error("no representation");
            }

            representation.segments = null;

            getSegments.call(self, representation);

            return representation;
        },

        updateRepresentation = function(representation, keepIdx) {
            var self = this,
                hasInitialization = representation.initialization,
                hasSegments = representation.segmentInfoType !== "BaseURL" && representation.segmentInfoType !== "SegmentBase",
                error;

            if (!representation.segmentDuration && !representation.segments) {
                updateSegmentList.call(self, representation);
            }

            representation.segmentAvailabilityRange = null;
            representation.segmentAvailabilityRange = self.timelineConverter.calcSegmentAvailabilityRange(representation, isDynamic);

            if ((representation.segmentAvailabilityRange.end < representation.segmentAvailabilityRange.start) && !representation.useCalculatedLiveEdgeTime) {
                error = new MediaPlayer.vo.Error(Dash.dependencies.DashHandler.SEGMENTS_UNAVAILABLE_ERROR_CODE, "no segments are available yet", {availabilityDelay: representation.segmentAvailabilityRange.start - representation.segmentAvailabilityRange.end});
                self.notify(Dash.dependencies.DashHandler.eventList.ENAME_REPRESENTATION_UPDATED, {representation: representation}, error);
                return;
            }

            if (!keepIdx) index = -1;

            if (representation.segmentDuration) {
                updateSegmentList.call(self, representation);
            }

            if (!hasInitialization) {
                self.baseURLExt.loadInitialization(representation);
            }

            if (!hasSegments) {
                self.baseURLExt.loadSegments(representation, type, representation.indexRange);
            }

            if (hasInitialization && hasSegments) {
                self.notify(Dash.dependencies.DashHandler.eventList.ENAME_REPRESENTATION_UPDATED, {representation: representation});
            }
        },

        getIndexForSegments = function (time, representation, timeThreshold) {
            var segments = representation.segments,
                ln = segments ? segments.length : null,
                idx = -1,
                epsilon,
                frag,
                ft,
                fd,
                i;

            if (segments && ln > 0) {
                for (i = 0; i < ln; i += 1) {
                    frag = segments[i];
                    ft = frag.presentationStartTime;
                    fd = frag.duration;
                    epsilon = (timeThreshold === undefined || timeThreshold === null) ? fd/2 : timeThreshold;

                    if ((time + epsilon) >= ft &&
                        (time - epsilon) < (ft + fd)) {
                        idx = frag.availabilityIdx;
                        break;
                    }
                }
            }

            // TODO : This is horrible.
            // Temp fix for SegmentTimeline refreshes.
            //if (idx === -1) {
            //    idx = 0;
            //}

            /*
            if (segments && segments.length > 0) {
                idx = 0;
                ft = segments[0].startTime / segments[0].timescale;
                frag = null;

                while (ft <= time && (idx + 1) < segments.length) {
                    frag = segments[idx];
                    ft += frag.duration / frag.timescale;
                    idx += 1;
                }
                idx -= 1;
            }
            */

            return idx;
        },

        getSegmentByIndex = function(index, representation) {
            if (!representation || !representation.segments) return null;

            var ln = representation.segments.length,
                seg,
                i;

            for (i = 0; i < ln; i += 1) {
                seg = representation.segments[i];

                if (seg.availabilityIdx === index) {
                    return seg;
                }
            }

            return null;
        },

        isSegmentListUpdateRequired = function(representation) {
            var updateRequired = false,
                segments = representation.segments,
                upperIdx,
                lowerIdx;

            if (!segments || segments.length === 0) {
                updateRequired = true;
            } else {
                lowerIdx = segments[0].availabilityIdx;
                upperIdx = segments[segments.length -1].availabilityIdx;
                updateRequired = (index < lowerIdx) || (index > upperIdx);
            }

            return updateRequired;
        },

        getRequestForSegment = function (segment) {
            if (segment === null || segment === undefined) {
                return null;
            }

            var request = new MediaPlayer.vo.FragmentRequest(),
                representation = segment.representation,
                bandwidth = representation.adaptation.period.mpd.manifest.Period_asArray[representation.adaptation.period.index].
                    AdaptationSet_asArray[representation.adaptation.index].Representation_asArray[representation.index].bandwidth,
                url;

            url = getRequestUrl(segment.media, representation);
            url = replaceTokenForTemplate(url, "Number", segment.replacementNumber);
            url = replaceTokenForTemplate(url, "Time", segment.replacementTime);
            url = replaceTokenForTemplate(url, "Bandwidth", bandwidth);
            url = replaceIDForTemplate(url, representation.id);
            url = unescapeDollarsInTemplate(url);

            request.mediaType = type;
            request.type = MediaPlayer.vo.metrics.HTTPRequest.MEDIA_SEGMENT_TYPE;
            request.url = url;
            request.range = segment.mediaRange;
            request.startTime = segment.presentationStartTime;
            request.duration = segment.duration;
            request.timescale = representation.timescale;
            request.availabilityStartTime = segment.availabilityStartTime;
            request.availabilityEndTime = segment.availabilityEndTime;
            request.wallStartTime = segment.wallStartTime;
            request.quality = representation.index;
            request.index = segment.availabilityIdx;
            request.mediaInfo = this.streamProcessor.getMediaInfo();

            return request;
        },

        getForTime = function(representation, time, options) {
            var request,
                segment,
                finished,
                idx = index,
                keepIdx = options ? options.keepIdx : false,
                timeThreshold = options ? options.timeThreshold : null,
                ignoreIsFinished = (options && options.ignoreIsFinished) ? true : false,
                self = this;

            if (!representation) {
                return null;
            }

            requestedTime = time;

            self.log("Getting the request for time: " + time);

            index = getIndexForSegments.call(self, time, representation, timeThreshold);
            getSegments.call(self, representation);

            if (index < 0) {
                index = getIndexForSegments.call(self, time, representation, timeThreshold);
            }

            //self.log("Got segments.");
            //self.log(segments);
            //self.log("Got a list of segments, so dig deeper.");
            self.log("Index for time " + time + " is " + index);

            finished = !ignoreIsFinished ? isMediaFinished.call(self, representation) : false;

            //self.log("Stream finished? " + finished);
            if (finished) {
                request = new MediaPlayer.vo.FragmentRequest();
                request.action = request.ACTION_COMPLETE;
                request.index = index;
                request.mediaType = type;
                request.mediaInfo = self.streamProcessor.getMediaInfo();

                self.log("Signal complete.");
                self.log(request);
            } else {
                //self.log("Got a request.");
                //self.log(request);
                segment = getSegmentByIndex(index, representation);
                request = getRequestForSegment.call(self, segment);
            }

            if (keepIdx) {
                index = idx;
            }

            return request;
        },

        generateForTime = function(representation, time) {
            var step = (representation.segmentAvailabilityRange.end - representation.segmentAvailabilityRange.start) / 2;

            representation.segments = null;
            representation.segmentAvailabilityRange = {start: time - step, end: time + step};
            return getForTime.call(this, representation, time, {keepIdx: false, ignoreIsFinished: true});
        },

        getNext = function (representation) {
            var request,
                segment,
                finished,
                idx,
                self = this;

            if (!representation) {
                return null;
            }

            //self.log("Getting the next request.");

            if (index === -1) {
                return null;
            }

            requestedTime = null;
            index += 1;
            idx = index;

            //self.log("New index: " + index);

            finished = isMediaFinished.call(self, representation);

            //self.log("Stream finished? " + finished);
            if (finished) {
                request = new MediaPlayer.vo.FragmentRequest();
                request.action = request.ACTION_COMPLETE;
                request.index = idx;
                request.mediaType = type;
                request.mediaInfo = self.streamProcessor.getMediaInfo();
                self.log("Signal complete.");
                //self.log(request);
            } else {
                getSegments.call(self, representation);
                //self.log("Got segments.");
                //self.log(segments);
                segment = getSegmentByIndex(idx, representation);
                request = getRequestForSegment.call(self, segment);
            }

            return request;
        },

        onInitializationLoaded = function(e) {
            var representation = e.data.representation;
            //self.log("Got an initialization.");
            if (!representation.segments) return;

            this.notify(Dash.dependencies.DashHandler.eventList.ENAME_REPRESENTATION_UPDATED, {representation: representation});
        },

        onSegmentsLoaded = function(e) {
            if (e.error || (type !== e.data.mediaType)) return;

            var self = this,
                fragments = e.data.segments,
                representation = e.data.representation,
                i,
                len,
                s,
                segments = [],
                count = 0,
                seg;

            for (i = 0, len = fragments.length; i < len; i+=1) {
                s = fragments[i];

                seg = getTimeBasedSegment.call(
                    self,
                    representation,
                    s.startTime,
                    s.duration,
                    s.timescale,
                    s.media,
                    s.mediaRange,
                    count);

                segments.push(seg);
                seg = null;
                count += 1;
            }

            representation.segmentAvailabilityRange = {start: segments[0].presentationStartTime, end: segments[len - 1].presentationStartTime};
            representation.availableSegmentsNumber = len;

            onSegmentListUpdated.call(self, representation, segments);

            if (!representation.initialization) return;

            this.notify(Dash.dependencies.DashHandler.eventList.ENAME_REPRESENTATION_UPDATED, {representation: representation});
        };

    return {
        log: undefined,
        baseURLExt: undefined,
        timelineConverter: undefined,
        metricsModel: undefined,
        metricsExt: undefined,
        notify: undefined,
        subscribe: undefined,
        unsubscribe: undefined,

        setup: function() {
            this[Dash.dependencies.BaseURLExtensions.eventList.ENAME_INITIALIZATION_LOADED] = onInitializationLoaded;
            this[Dash.dependencies.BaseURLExtensions.eventList.ENAME_SEGMENTS_LOADED] = onSegmentsLoaded;
        },

        initialize: function(streamProcessor) {
            this.subscribe(Dash.dependencies.DashHandler.eventList.ENAME_REPRESENTATION_UPDATED, streamProcessor.representationController);
            type = streamProcessor.getType();
            this.setMediaType(type);
            isDynamic = streamProcessor.isDynamic();
            this.streamProcessor = streamProcessor;
        },

        getType: function () {
            return type;
        },

        setType : function (value) {
            type = value;
        },

        getIsDynamic: function () {
            return isDynamic;
        },
        setIsDynamic: function (value) {
            isDynamic = value;
        },

        setCurrentTime: function(value) {
            currentTime = value;
        },

        getCurrentTime: function() {
            return currentTime;
        },

        reset: function() {
            currentTime = 0;
            requestedTime = undefined;
            index = -1;
            isDynamic = undefined;
            this.unsubscribe(Dash.dependencies.DashHandler.eventList.ENAME_REPRESENTATION_UPDATED, this.streamProcessor.representationController);
        },

        getInitRequest: getInit,
        getSegmentRequestForTime: getForTime,
        getNextSegmentRequest: getNext,
        generateSegmentRequestForTime: generateForTime,
        updateRepresentation: updateRepresentation
    };
};

Dash.dependencies.DashHandler.prototype = {
    constructor: Dash.dependencies.DashHandler
};

Dash.dependencies.DashHandler.SEGMENTS_UNAVAILABLE_ERROR_CODE = 1;

Dash.dependencies.DashHandler.eventList = {
    ENAME_REPRESENTATION_UPDATED: "representationUpdated"
};
