import React from 'react';
import PropTypes from 'prop-types';
import Moment from 'moment';
import NumAbbr from 'number-abbreviate';
import tt from 'counterpart';
import cx from 'classnames';
import Userpic, { SIZE_SMALL } from 'app/components/elements/Userpic';
import { numberWithCommas } from 'app/utils/StateFunctions';
import { APP_URL, REFUND_ACCOUNTS, BURN_ACCOUNTS } from 'app/client_config';
import Icon from 'app/components/elements/Icon';
import RemoveProposal from 'app/components/modules/RemoveProposal';

const numAbbr = new NumAbbr();

function getFundingType(account) {
    if (REFUND_ACCOUNTS.includes(account)) return 'refund';
    if (BURN_ACCOUNTS.includes(account)) return 'burn';
    return null;
}

function getIsFunded(paid_proposals, id, start, end) {
    if (Array.isArray(paid_proposals)) {
        const now = Date.now();
        const remainingTimeUntilStart = start - now;
        const remainingTimeUntilFinished = end - now;
        if (
            remainingTimeUntilStart <= 0 &&
            (paid_proposals.includes(id) && remainingTimeUntilFinished > 0)
        ) {
            return 'funded';
        }
    }
    return null;
}

export default class Proposal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            show_remove_proposal_modal: false,
        };
    }

    hideRemoveProposal = (show = false) => {
        this.setState({ show_remove_proposal_modal: show });
    };

    render() {
        const {
            id,
            currentUser,
            start_date,
            end_date,
            creator,
            receiver,
            daily_pay,
            subject,
            total_votes,
            permlink,
            onVote,
            isVoting,
            voteFailed,
            isUpVoted,
            total_vesting_shares,
            total_vesting_fund_steem,
            triggerModal,
            getNewId,
            paid_proposals,
        } = this.props;

        const { show_remove_proposal_modal } = this.state;
        let isMyAccount;
        if (currentUser) {
            try {
                isMyAccount = currentUser === creator;
            } catch (error) {
                console.error('Error checking current user:', error);
            }
        }

        const start = new Date(start_date);
        const end = new Date(end_date);
        const durationInDays = Moment(end).diff(Moment(start), 'days');
        const totalPayout = durationInDays * daily_pay.split(' SBD')[0];
        const votesToSP = simpleVotesToSp(
            total_votes,
            total_vesting_shares,
            total_vesting_fund_steem
        );
        const fundingType = getFundingType(receiver);
        const isFunded = getIsFunded(paid_proposals, id, start, end);
        const classUp = cx('Voting__button', 'Voting__button-up', {
            'Voting__button--upvoted': isUpVoted,
            'Voting__button--downvoted': voteFailed,
            votingUp: isVoting,
        });

        const handleVoteClick = () => {
            getNewId(id);
            triggerModal();
        };

        return (
            <div className="proposals__item">
                <div className="proposals__content">
                    <a
                        className="proposals__row title"
                        href={urlifyPermlink(creator, permlink)}
                        target="_blank"
                        rel="noopener noreferrer"
                        alt={startedOrFinishedInWordsLongVersion(start, end)}
                        title={startedOrFinishedInWordsLongVersion(start, end)}
                    >
                        {subject}&nbsp;<span className="id">#{id}</span>
                    </a>
                    <div className="proposals__row description">
                        <div className="date">
                            {formatDate(start)}&nbsp;-&nbsp;{formatDate(end)}
                            &nbsp;(
                            {durationInDays} {tt('proposals.days')})
                        </div>
                        <div className="right-content">
                            <div className="amount">
                                <span title={formatCurrency(totalPayout)}>
                                    {abbreviateNumber(totalPayout)} SBD
                                </span>
                                &nbsp;(
                                {tt('proposals.daily')}&nbsp;
                                {abbreviateNumber(daily_pay.split(' ')[0])} SBD)
                            </div>
                            <div className="flags">
                                <span
                                    className="status"
                                    title={startedOrFinishedInWordsLongVersion(
                                        start,
                                        end
                                    )}
                                >
                                    {startedOrFinished(start, end)}
                                </span>
                                {isFunded && (
                                    <span
                                        className={cx(
                                            'status',
                                            'funding-type',
                                            'funded'
                                        )}
                                        title={tt('proposals.funded_title')}
                                    >
                                        {tt(`proposals.funded`)}
                                    </span>
                                )}
                                {fundingType && (
                                    <span
                                        className={cx(
                                            'status',
                                            'funding-type',
                                            fundingType
                                        )}
                                        title={tt(
                                            `proposals.${fundingType}_title`
                                        )}
                                    >
                                        {tt(`proposals.${fundingType}`)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="proposals__row details">
                        <Userpic account={creator} size={SIZE_SMALL} />
                        <div className="creator">
                            {tt('proposals.by')}&nbsp;{linkifyUsername(creator)}
                            {creator != receiver ? (
                                <span>
                                    &nbsp;{tt('proposals.for')}&nbsp;
                                    {linkifyUsername(receiver)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                </div>
                <div className="proposals__votes">
                    <div
                        className="total_votes"
                        tabIndex={0}
                        role="button"
                        onClick={handleVoteClick}
                        title={`${votesToSP} SP`}
                    >
                        {abbreviateNumber(votesToSP)}
                    </div>
                    <span onClick={onVote} tabIndex={0} role="button">
                        <span className={classUp}>
                            <Icon
                                name={isVoting ? 'empty' : 'chevron-up-circle'}
                                className="upvote"
                            />
                        </span>
                    </span>
                    {isMyAccount && (
                        <div
                            tabIndex={0}
                            role="button"
                            onClick={() => {
                                this.hideRemoveProposal(true);
                            }}
                            className="proposal_remove"
                        >
                            <span>{tt('proposals.remove')}</span>
                        </div>
                    )}
                </div>
                {isMyAccount && (
                    <div
                        tabIndex={0}
                        role="button"
                        onClick={() => {
                            this.hideRemoveProposal(true);
                        }}
                        className="proposal_remove--small"
                    >
                        <span>{tt('proposals.remove')}</span>
                    </div>
                )}
                {show_remove_proposal_modal && (
                    <RemoveProposal
                        proposalID={id}
                        show_remove_proposal_modal={show_remove_proposal_modal}
                        hideRemoveProposal={e => {
                            this.hideRemoveProposal(false);
                        }}
                        removeProposalById={this.props.removeProposalById}
                    />
                )}
            </div>
        );
    }
}

Proposal.propTypes = {
    id: PropTypes.number.isRequired,
    creator: PropTypes.string.isRequired,
    receiver: PropTypes.string.isRequired,
    start_date: PropTypes.string.isRequired,
    end_date: PropTypes.string.isRequired,
    daily_pay: PropTypes.string.isRequired,
    subject: PropTypes.string.isRequired,
    total_votes: PropTypes.number.isRequired,
    permlink: PropTypes.string.isRequired,
    onVote: PropTypes.func.isRequired,
    isVoting: PropTypes.bool.isRequired,
    isUpVoted: PropTypes.bool.isRequired,
    total_vesting_shares: PropTypes.string.isRequired,
    total_vesting_fund_steem: PropTypes.string.isRequired,
};

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
        return 'finished';
    }
    if (remainingTimeUntilStart <= 0) {
        return 'started';
    }
    return 'not started';
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
        return `finished ${durationInWords(remainingTimeUntilFinished)}`;
    }
    if (remainingTimeUntilStart <= 0) {
        return `started ${durationInWords(
            remainingTimeUntilStart
        )} ago and finishes ${durationInWords(remainingTimeUntilFinished)}`;
    }
    return `will start ${durationInWords(remainingTimeUntilStart)}`;
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
        <a
            href={`${APP_URL}/@${username}`}
            target="_blank"
            rel="noopener noreferrer"
        >
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
    return `${APP_URL}/@${username}/${permlink}`;
}

/**
 * Given total votes in vests returns value in SP
 * @param {number} total_votes - total votes on a proposal (vests from API)
 * @param {string} total_vesting_shares - vesting shares with vests symbol on end
 * @param {string} total_vesting_fund_steem - total steem vesting fund with liquid symbol on end
 * @returns {number} - return the number converted to SP
 */
function simpleVotesToSp(
    total_votes,
    total_vesting_shares,
    total_vesting_fund_steem
) {
    const total_vests = parseFloat(total_vesting_shares);
    const total_vest_steem = parseFloat(total_vesting_fund_steem || 0);
    return (total_vest_steem * (total_votes / total_vests) * 0.000001).toFixed(
        2
    );
}
