import React from 'react';
import { Link } from 'react-router';
import tt from 'counterpart';
import Icon from 'app/components/elements/Icon';
import { numberWithCommas } from 'app/utils/StateFunctions';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import { ASC, ACCOUNT, OWN_SP, PROXY_SP, INFLUENCE } from './constants';

class SmallTable extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Table');
    }

    proxyVoteStyle(value, final_string = ' SP') {
        return `${value}${final_string}`;
    }

    render() {
        const {
            sortData,
            sortDataAux,
            sortBy,
            sort,
            new_id,
            total,
            totalEffectiveVotes,
        } = this.props;

        return (
            <table>
                <thead>
                    <tr>
                        <th style={{ minWidth: '100%' }}>
                            <span
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    float: 'left',
                                    marginLeft: 0,
                                    minWidth: '100%',
                                    gap: '0.5rem',
                                }}
                            >
                                <span
                                    role="button"
                                    tabIndex="0"
                                    onClick={() => {
                                        sortData(ACCOUNT);
                                    }}
                                >
                                    {`${tt(
                                        'proposals.voters.account'
                                    )} (${total})`}
                                    <span
                                        className={
                                            sortBy === ACCOUNT
                                                ? 'icon--active'
                                                : ''
                                        }
                                    >
                                        {sort !== ASC ? (
                                            <Icon name="dropdown-arrow" />
                                        ) : (
                                            <Icon
                                                name="dropdown-arrow"
                                                className="up-arrow"
                                                style={{
                                                    transform: 'rotate(180deg)',
                                                }}
                                            />
                                        )}
                                    </span>
                                </span>
                                <span
                                    role="button"
                                    tabIndex="0"
                                    onClick={() => {
                                        sortData(OWN_SP);
                                    }}
                                >
                                    {tt('proposals.voters.own_sp')}
                                    <span
                                        className={
                                            sortBy === OWN_SP
                                                ? 'icon--active'
                                                : ''
                                        }
                                    >
                                        {sort !== ASC ? (
                                            <Icon name="dropdown-arrow" />
                                        ) : (
                                            <Icon
                                                name="dropdown-arrow"
                                                className="up-arrow"
                                                style={{
                                                    transform: 'rotate(180deg)',
                                                }}
                                            />
                                        )}
                                    </span>
                                </span>
                                <span
                                    role="button"
                                    tabIndex="0"
                                    onClick={() => {
                                        sortData(PROXY_SP);
                                    }}
                                >
                                    {tt('proposals.voters.proxy_sp')}
                                    <span
                                        className={
                                            sortBy === PROXY_SP
                                                ? 'icon--active'
                                                : ''
                                        }
                                    >
                                        {sort !== ASC ? (
                                            <Icon name="dropdown-arrow" />
                                        ) : (
                                            <Icon
                                                name="dropdown-arrow"
                                                className="up-arrow"
                                                style={{
                                                    transform: 'rotate(180deg)',
                                                }}
                                            />
                                        )}
                                    </span>
                                </span>
                                <span
                                    role="button"
                                    tabIndex="0"
                                    onClick={() => {
                                        sortData(INFLUENCE);
                                    }}
                                >
                                    {tt('proposals.voters.influence')}
                                    <span
                                        className={
                                            sortBy === INFLUENCE
                                                ? 'icon--active'
                                                : ''
                                        }
                                    >
                                        {sort !== ASC ? (
                                            <Icon name="dropdown-arrow" />
                                        ) : (
                                            <Icon
                                                name="dropdown-arrow"
                                                className="up-arrow"
                                                style={{
                                                    transform: 'rotate(180deg)',
                                                }}
                                            />
                                        )}
                                    </span>
                                </span>
                            </span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {sortDataAux.map(each => {
                        const proxy_name = each[4];
                        let proxy_vote = true;
                        let proxy_vote_row = '';
                        if (proxy_name) {
                            proxy_vote = each[5];
                            proxy_vote_row = proxy_vote
                                ? 'proxy_vote_row'
                                : 'highlighted_row';
                        }
                        const total_votes = parseFloat(totalEffectiveVotes);
                        let influence =
                            (parseFloat(each[1].toFixed(2)) / total_votes) *
                            100;
                        influence = influence > 100 ? 100 : influence;
                        const userInfo = {
                            name: each[0],
                            steemPower: each[2].toFixed(2),
                            proxySP: each[3].toFixed(2),
                            influence:
                                total_votes && total_votes > 0
                                    ? `${influence.toFixed(2)}`
                                    : each[6].toFixed(2),
                        };

                        return (
                            <tr key={`${new_id}-${each[0]}`}>
                                <td
                                    className={`${
                                        proxy_name ? proxy_vote_row : ''
                                    }`}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.5rem',
                                    }}
                                >
                                    <span>
                                        <Link to={`/@${userInfo.name}`}>
                                            {userInfo.name}
                                        </Link>
                                    </span>
                                    <span>
                                        {this.proxyVoteStyle(
                                            numberWithCommas(
                                                userInfo.steemPower
                                            )
                                        )}
                                    </span>
                                    <span>
                                        {this.proxyVoteStyle(
                                            numberWithCommas(userInfo.proxySP)
                                        )}
                                    </span>
                                    <span className="influence-cell">
                                        <span className="proxied_to">
                                            {proxy_name &&
                                                tt(
                                                    'proposals.voters.proxied_to'
                                                )}
                                            <Link to={`/@${proxy_name}`}>
                                                {proxy_name}
                                            </Link>
                                        </span>
                                        {proxy_vote
                                            ? this.proxyVoteStyle(
                                                  numberWithCommas(
                                                      userInfo.influence
                                                  ),
                                                  ' %'
                                              )
                                            : '0 %'}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    }
}
export default SmallTable;
