import React from 'react';
import PropTypes from 'prop-types';
import Moment from 'moment';
import NumAbbr from 'number-abbreviate';
import { numberWithCommas, vestsToSpf } from 'app/utils/StateFunctions';

import Icon from 'app/components/elements/Icon';

const numAbbr = new NumAbbr();
Proposal.propTypes = {
    id: PropTypes.number.isRequired,
    creator: PropTypes.string.isRequired,
    receiver: PropTypes.string.isRequired,
    start_date: PropTypes.string.isRequired,
    end_date: PropTypes.string.isRequired,
    daily_pay: PropTypes.object.isRequired, // TODO: Specify shape.
    subject: PropTypes.string.isRequired,
    total_votes: PropTypes.number.isRequired,
    permlink: PropTypes.string.isRequired,
    onVote: PropTypes.func.isRequired,
    isVoting: PropTypes.bool.isRequired,
    isUpVoted: PropTypes.bool.isRequired,
    total_vesting_shares: PropTypes.number.isRequired,
    total_vesting_fund_steem: PropTypes.number.isRequired,
};

export default function Proposal(props) {
    // console.log('Proposal.jsx->()', props);
    const {
        id,
        creator,
        receiver,
        daily_pay,
        subject,
        total_votes,
        permlink,
        onVote,
        isVoting,
        voteFailed,
        voteSucceeded,
        isUpVoted,
        total_vesting_shares,
        total_vesting_fund_steem,
    } = props;

    const start = new Date(props.start_date);
    const end = new Date(props.end_date);
    const durationInDays = Moment(end).diff(Moment(start), 'days');
    const totalPayout = durationInDays * daily_pay.split(' SBD')[0]; // ¯\_(ツ)_/¯
    const total_votes_in_sp = vestsToSpf(
        total_vesting_shares,
        total_vesting_fund_steem,
        parseFloat(total_votes)
    ).toFixed(3);

    console.log(
        'PROPOSAL-RENDER(isUpVoted, voteSucceeded, voteFailed, isVoting)',
        props,
        isUpVoted,
        voteSucceeded,
        voteFailed,
        isVoting,
        total_votes_in_sp,
        total_vesting_shares,
        total_vesting_fund_steem,
        total_votes
    );
    const classUp =
        'Voting__button Voting__button-up' +
        (isUpVoted ? ' Voting__button--upvoted' : '') +
        (voteFailed ? ' Voting__button--downvoted' : '') +
        (isVoting ? ' votingUp' : '');
    return (
        <div className="proposals__row">
            <div className="proposals__votes">
                <a onClick={onVote}>
                    <span className={classUp}>
                        <Icon
                            name={isVoting ? 'empty' : 'chevron-up-circle'}
                            className="upvote"
                        />
                    </span>
                </a>

                <span>{abbreviateNumber(total_votes_in_sp)}</span>
            </div>
            <div className="proposals__description">
                <span>
                    <a
                        href={urlifyPermlink(creator, permlink)}
                        target="_blank"
                        alt={startedOrFinishedInWordsLongVersion(start, end)}
                        title={startedOrFinishedInWordsLongVersion(start, end)}
                    >
                        {subject}
                        <span
                            className="proposals__statusTag"
                            title={startedOrFinishedInWordsLongVersion(
                                start,
                                end
                            )}
                        >
                            {startedOrFinished(start, end)}
                        </span>
                    </a>
                </span>
                <br />
                <small className="date">
                    {formatDate(start)} through {formatDate(end)}
                </small>
                <br />
                <small>
                    by {linkifyUsername(creator)} for{' '}
                    {linkifyUsername(
                        checkIfSameUser(creator, receiver, 'themselves.'),
                        receiver
                    )}
                </small>
            </div>
            <div className="proposals__amount">
                <span>
                    <a href="#" title={formatCurrency(totalPayout)}>
                        <em>${abbreviateNumber(totalPayout)}</em>
                    </a>
                </span>
                <small>
                    ${abbreviateNumber(daily_pay.split(' SBD')[0])} per day for{' '}
                    {durationInDays} days
                </small>
            </div>
        </div>
    );
}

/**
 * Given a number, return a string with the number formatted as currency
 * @param {number} number - number to format
 * @returns {string} - return a fancy string
 */
function formatCurrency(amount = 0) {
    return numberWithCommas(Number.parseFloat(amount).toFixed(2) + 'SBD');
}

/**
 * Given a number, return a slightly more readable version in the form of an abbreviation.
 * @param {number} number - number to abbreviate
 * @returns {string} - return the abreviated number as a string.
 */
function abbreviateNumber(number) {
    return numAbbr.abbreviate(number, 2);
}

/**
 * Given a start date and an end date return one of [started, finished, not started]
 * @param {Date} start - start date
 * @param {Date} stop - stop date
 * @returns {string} - return fancy string
 */
function startedOrFinished(start, end) {
    const now = Date.now();
    const remainingTimeUntilStart = start - now;
    const remainingTimeUntilFinished = end - now;

    if (remainingTimeUntilFinished <= 0) {
        // Finished
        return `finished`;
    }

    if (remainingTimeUntilStart <= 0) {
        // Started
        return `started`;
    }

    // Not started and not finished
    return `not started`;
}

/**
 * Given a date formate it
 * @param {Date} date - date
 * @returns {string} - return fancy string
 */
function formatDate(date) {
    return Moment(date).format('ll');
}

/**
 * Given a start date and an end date return a sentence decribing whether it has started, stopped, or has yet to begin.
 * @param {Date} start - start date
 * @param {Date} stop - stop date
 * @returns {string} - return fancy string
 */
function startedOrFinishedInWordsLongVersion(start, end) {
    const now = Date.now();
    const remainingTimeUntilStart = start - now;
    const remainingTimeUntilFinished = end - now;

    if (remainingTimeUntilFinished <= 0) {
        // Finished
        return `finished ${durationInWords(remainingTimeUntilFinished)}`;
    }

    if (remainingTimeUntilStart <= 0) {
        // Started
        return `started ${durationInWords(
            remainingTimeUntilStart
        )} ago and finishes ${durationInWords(remainingTimeUntilFinished)}`;
    }

    // Not started and not finished
    return `will start ${durationInWords(remainingTimeUntilStart)}`;
}

/**
 * Given a time, return a friendly phrase escribing the amount of time until then
 * @param {number} timestamp - timestamp to convert
 * @returns {string} - return the time phrase as a string
 */
function timeUntil(timestamp) {
    return timestamp;
    // return timeAgo.format(new Date(timestamp));
}

/**
 * Given a time, return a friendly phrase escribing the total amount of time
 * @param {number} duration - timestamp to convert
 * @returns {string} - return the time phrase as a string
 */
function durationInWords(duration) {
    const now = Date.now();
    const a = Moment(now);
    const b = Moment(now + duration);
    return b.from(a);
    // return timeAgo.format(duration, 'time');
}

/**
 * Given two usernames, see if they are the same. Optionally. specify a value to return if they are the same. If not the same, returns username b.
 * @param {string} usernamea- usernamea
 * @param {string} usernameb- usernameb
 * @param {string} valueIfSame - value to return if the two usernames match. default true
 * @returns {bool|string} - returns usernameb if it doesn't match usernameb.
 */
function checkIfSameUser(usernamea, usernameb, valueIfSame = true) {
    if (
        `${usernamea.toLowerCase()}`.trim() ==
        `${usernameb.toLowerCase()}`.trim()
    ) {
        return valueIfSame;
    }
    return usernameb;
}

/**
 * Given a username, return an HTML A tag pointing to that user.
 * @param {string} linkText - linkText
 * @param {string} username - username
 * @returns {string} - return a linkified strong
 */
function linkifyUsername(linkText, username = '') {
    if (username == '') username = linkText;
    return (
        <a href={`https://steemit.com/@${username}/feed`} target="_blank">
            {linkText}
        </a>
    );
}

/**
 * Given a username, and post permlink id return a URL worthy strong.
 * @param {string} username - username
 * @param {string} permlink - permlink id of the linked post
 * @returns {string} - return a URL string
 */
function urlifyPermlink(username, permlink) {
    return `https://steemit.com/@${username}/${permlink}`;
}
