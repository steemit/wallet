import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import * as userActions from 'app/redux/UserReducer';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import TimeAgoWrapper from 'app/components/elements/TimeAgoWrapper';
import Pagination from 'app/components/elements/OutgoingDelegationsTables/Pagination';
import Icon from 'app/components/elements/Icon';
import { numberWithCommas } from 'app/utils/StateFunctions';
import { ASC, DESC, DATE, AMOUNT, PAGE_LIMIT } from 'app/components/elements/OutgoingDelegationsTables/constants'

class ExpiringDelegations extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'ExpiringDelegations');
        this.state = {
            sortBy: '',
            sort: DESC,
            currentPage: 1,
        };
    }

    componentWillMount() {
        const { props } = this;
        props.expiringVestingDelegationsLoading(true);
        props.getExpiringVestingDelegations(props.account.get('name'), (res, err) => {
            // Sort by the first field by default
            this.sortData(DATE, res)
        });
    }

    sortData = (field, baseData = null) => {
        const { sortBy, sort } = this.state;
        const {
            expiringVestingDelegations,
            expiringVestingDelegationsLoading,
            setExpiringVestingDelegations
        } = this.props;
        expiringVestingDelegationsLoading(true);
        let data = baseData ? baseData : expiringVestingDelegations
        const sortMethod = (sortBy !== field)
            ? ASC
            : sort === ASC
                ? DESC
                : ASC
        switch (field) {
            case AMOUNT:
                if (sortMethod === ASC) {
                    data.sort((a, b) => parseFloat(a.vesting_shares.amount) - parseFloat(b.vesting_shares.amount))
                }
                else {
                    data.sort((a, b) => parseFloat(b.vesting_shares.amount) - parseFloat(a.vesting_shares.amount))
                }
                break;
            case DATE:
                if (sortMethod === ASC) {
                    data.sort((a, b) => {
                        const dateA = new Date(a.expiration).getTime();
                        const dateB = new Date(b.expiration).getTime();
                        return dateA > dateB ? 1 : -1
                    })
                }
                else {
                    data.sort((a, b) => {
                        const dateA = new Date(a.expiration).getTime();
                        const dateB = new Date(b.expiration).getTime();
                        return dateA > dateB ? -1 : 1
                    })
                }
                break;
            default:
                break;
        }
        setExpiringVestingDelegations(data);
        expiringVestingDelegationsLoading(false);
        this.setState({ sortBy: field, sort: sortMethod })
    }

    onPageChanged = dt => {
        this.setState({ currentPage: dt.currentPage })
    }

    render() {

        const { sortBy, sort, currentPage } = this.state;

        const {
            account,
            expiringVestingDelegations,
            totalVestingShares,
            totalVestingFund,
            expiringVestingDelegationsPending,
        } = this.props;

        const offset = (currentPage - 1) * PAGE_LIMIT

        const updateClipboard = (value) => {
            if (window.location.protocol === "https:") {
                navigator.clipboard.writeText(value).then(() => { console.log(value) }, () => console.error('error.'));
            }
        }

        const convertVestsToSteem = (vests) => {
            return ((vests * totalVestingFund) / totalVestingShares).toFixed(3);
        };
        // do not render if account is not loaded or available
        if (!account) return null;
        // do not render if state appears to contain only lite account info
        if (!account.has('vesting_shares')) return null;

        let delegation_log = expiringVestingDelegations
            ? expiringVestingDelegations.length > PAGE_LIMIT
                ? expiringVestingDelegations.slice(offset, offset + PAGE_LIMIT)
                : expiringVestingDelegations
            : []
        delegation_log = delegation_log.map((item) => {
            const currentVest = item.vesting_shares.amount / 10 ** item.vesting_shares.precision
            const vestsAsSteem = convertVestsToSteem(parseFloat(currentVest));
            return (
                <tr
                    key={`${item.delegator}--${item.id}--${item.expiration}`}
                >
                    <td
                        className="text--capitalize"
                    >
                        <span
                            onClick={() => { updateClipboard(item.expiration) }}
                            style={{ cursor: "pointer" }}
                        >
                            <TimeAgoWrapper date={item.expiration} />
                        </span>
                    </td>
                    <td
                        title={`${currentVest} VESTS`}
                        className="column-number"
                    >
                        <span
                            style={{ cursor: "pointer" }}
                            onClick={(e) => { updateClipboard(`${numberWithCommas(vestsAsSteem)} SP`) }}
                        >
                            {`${numberWithCommas(vestsAsSteem)} SP`}
                        </span>
                    </td>
                </tr>
            );
        }
        )

        return (
            <div className="ExpiringDelegations">
                <div className="ExpiringDelegations__table-container">
                    {expiringVestingDelegationsPending
                        ? (
                            <table>
                                <tbody>
                                    <tr>
                                        <td style={{ textAlign: 'center' }}>
                                            <LoadingIndicator type="circle" />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        )
                        : delegation_log.length
                            ? (<div>
                                <table>
                                    <thead>
                                        <tr>
                                            <th
                                                onClick={() => { this.sortData(DATE) }}
                                                style={{ cursor: 'pointer' }}
                                                >
                                                {tt('expiringdelegations_jsx.end_date')}
                                                <span className={sortBy === DATE ? "icon--active" : ""}>
                                                    {sort !== ASC
                                                        ? (<Icon name="dropdown-arrow" />)
                                                        : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                                    }
                                                </span>
                                            </th>
                                            <th
                                                onClick={() => { this.sortData(AMOUNT) }}
                                                style={{ cursor: 'pointer' }}
                                                className="column-number"
                                            >
                                                {tt('expiringdelegations_jsx.amount_returned')}
                                                <span className={sortBy === AMOUNT ? "icon--active" : ""}>
                                                    {sort !== ASC
                                                        ? (<Icon name="dropdown-arrow" />)
                                                        : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                                    }
                                                </span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>{delegation_log}</tbody>
                                </table>
                                {expiringVestingDelegations.length > PAGE_LIMIT ?
                                    <Pagination totalRecords={expiringVestingDelegations.length} pageLimit={PAGE_LIMIT} pageNeighbours={1} onPageChanged={this.onPageChanged} />
                                    : <div />
                                }
                            </div>)
                            : (
                                <table>
                                    <tbody>
                                        <tr>
                                            <td style={{ textAlign: 'center' }}>
                                                {tt('expiringdelegations_jsx.no_delegations')}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            )
                    }
                </div>
            </div>
        );
    }
}
export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const expiringVestingDelegations = state.user.get('expiringVestingDelegations');

        const expiringVestingDelegationsPending = state.user.get(
            'expiringVestingDelegationsLoading'
        );
        const totalVestingShares = state.global.getIn([
            'props',
            'total_vesting_shares',
        ])
            ? parseFloat(
                state.global
                    .getIn(['props', 'total_vesting_shares'])
                    .split(' ')[0]
            )
            : 0;

        const totalVestingFund = state.global.getIn([
            'props',
            'total_vesting_fund_steem',
        ])
            ? parseFloat(
                state.global
                    .getIn(['props', 'total_vesting_fund_steem'])
                    .split(' ')[0]
            )
            : 0;
        return {
            ...ownProps,
            expiringVestingDelegations,
            totalVestingShares,
            totalVestingFund,
            expiringVestingDelegationsPending,
        };
    },
    // mapDispatchToProps
    (dispatch) => ({
        getExpiringVestingDelegations: (account, successCallback) => {
            dispatch(
                userActions.getExpiringVestingDelegations({ account, successCallback })
            );
        },
        setExpiringVestingDelegations: (payload) => {
            dispatch(userActions.setExpiringVestingDelegations(payload));
        },
        expiringVestingDelegationsLoading: (payload) => {
            dispatch(userActions.expiringVestingDelegationsLoading(payload));
        }
    })
)(ExpiringDelegations);
