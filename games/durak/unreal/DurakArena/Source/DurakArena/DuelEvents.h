#pragma once
namespace DurakEvents {
inline bool Crossed(float Previous,float Current,float Event) {
    // FIX: half-open interval excludes a cue already handled in the previous frame.
    return Current>=Previous && Previous<Event && Current>=Event;
}
}
