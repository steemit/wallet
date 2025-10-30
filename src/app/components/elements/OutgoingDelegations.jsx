import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import ConfirmDelegationTransfer from 'app/components/elements/ConfirmDelegationTransfer';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import * as userActions from 'app/redux/UserReducer';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import Pagination from 'app/components/elements/OutgoingDelegationsTables/Pagination';
import SmallTable from 'app/components/elements/OutgoingDelegationsTables/SmallTable';
import Table from 'app/components/elements/OutgoingDelegationsTables/Table';
import {
    ASC,
    DESC,
    DELEGATEE,
    DATE,
    AMOUNT,
    PAGE_LIMIT,
    API_URL,
    API_LIMIT,
} from 'app/components/elements/OutgoingDelegationsTables/constants';

const fetchData = async params => {
    const requestData = {
        jsonrpc: '2.0',
        method: 'condenser_api.get_vesting_delegations',
        params,
        id: 2,
    };

    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
    };

    try {
        const response = await fetch(API_URL, requestOptions);
        const data = await response.json();
        return data.result;
    } catch (error) {
        throw error;
    }
};

class OutgoingDelegations extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(
            this,
            'OutgoingDelegations'
        );
        this.isComponentMounted = false;
        this.state = {
            sortBy: '',
            sort: DESC,
            delegatee: '',
            auxiliaryData: '',
            isSmallScreen: false,
            currentPage: 1,
            count: 0,
            indefiniteLoading: false,
        };
    }

    componentDidMount() {
        this.isComponentMounted = true;
        const { props } = this;
        window.addEventListener('resize', this.handleResize);
        this.handleResize();
        props.vestingDelegationsLoading(true);
        props.getVestingDelegations(props.account.get('name'), (err, res) => {
            if (res.length === 1000) {
                this.setState({ indefiniteLoading: true });
                // Initialize the timeout with 250 milliseconds
                this.getVestingDelegationsRecursive(res, 250).then(
                    finalResult => {
                        this.setState({
                            count: finalResult.length,
                            auxiliaryData: finalResult,
                            indefiniteLoading: false,
                        });
                        this.updateVestingDelegations(finalResult);
                    }
                );
            } else {
                this.setState({ auxiliaryData: res });
                this.sortData(DELEGATEE, res);
            }
        });
    }

    componentWillUnmount() {
        window.removeEventListener('resize', this.handleResize);
        this.isComponentMounted = false;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
    }

    sortData = (field, baseData = null) => {
        const { sortBy, sort } = this.state;
        const { vestingDelegations, vestingDelegationsLoading } = this.props;
        vestingDelegationsLoading(true);
        let data = baseData ? baseData : vestingDelegations;
        const sortMethod = sortBy !== field ? ASC : sort === ASC ? DESC : ASC;
        switch (field) {
            case AMOUNT:
                data =
                    sortMethod === ASC
                        ? data.sort(
                              (a, b) =>
                                  parseFloat(a.vesting_shares) -
                                  parseFloat(b.vesting_shares)
                          )
                        : data.sort(
                              (a, b) =>
                                  parseFloat(b.vesting_shares) -
                                  parseFloat(a.vesting_shares)
                          );
                break;
            case DELEGATEE:
                data =
                    sortMethod === ASC
                        ? data.sort((a, b) => {
                              const delegateeA = a.delegatee.toLowerCase();
                              const delegateeB = b.delegatee.toLowerCase();
                              if (delegateeA < delegateeB) {
                                  return -1;
                              }
                              if (delegateeA > delegateeB) {
                                  return 1;
                              }
                              return 0;
                          })
                        : data.sort((a, b) => {
                              const delegateeA = a.delegatee.toLowerCase();
                              const delegateeB = b.delegatee.toLowerCase();
                              if (delegateeA < delegateeB) {
                                  return 1;
                              }
                              if (delegateeA > delegateeB) {
                                  return -1;
                              }
                              return 0;
                          });
                break;
            case DATE:
                data =
                    sortMethod === ASC
                        ? data.sort((a, b) => {
                              const dateA = new Date(
                                  a.min_delegation_time
                              ).getTime();
                              const dateB = new Date(
                                  b.min_delegation_time
                              ).getTime();
                              return dateA > dateB ? 1 : -1;
                          })
                        : data.sort((a, b) => {
                              const dateA = new Date(
                                  a.min_delegation_time
                              ).getTime();
                              const dateB = new Date(
                                  b.min_delegation_time
                              ).getTime();
                              return dateA > dateB ? -1 : 1;
                          });
                break;
            default:
                break;
        }
        this.setState({ sortBy: field, sort: sortMethod, currentPage: 1 });
        this.updateVestingDelegations(data);
    };

    handleResize = () => {
        this.setState({ isSmallScreen: window.innerWidth <= 425 });
    };

    updateVestingDelegations = res => {
        const { setVestingDelegations, vestingDelegationsLoading } = this.props;
        setVestingDelegations(res);
        vestingDelegationsLoading(false);
    };

    handleFindAccounts = e => {
        const { value } = e.target;
        const { vestingDelegationsLoading } = this.props;
        const { auxiliaryData, currentPage } = this.state;
        const currentValue = value.replace(/\s/g, '');
        this.setState({ delegatee: currentValue, sortBy: '', sort: DESC });
        vestingDelegationsLoading(true);
        let data = auxiliaryData;
        data = data.filter(item =>
            item.delegatee.includes(currentValue.toLowerCase())
        );
        if (currentPage !== 1) {
            this.setState({ currentPage: 1 });
        }
        this.updateVestingDelegations(data);
    };

    onPageChanged = dt => {
        this.setState({ currentPage: dt.currentPage });
    };

    getVestingDelegationsRecursive = async (result, timeout) => {
        try {
            const delegatee = result[result.length - 1].delegatee;
            const res = await fetchData(['steem', delegatee, API_LIMIT]);
            if (res.length > 1 && this.isComponentMounted) {
                result = result.concat(res.slice(1));
                if (res.length < API_LIMIT) {
                    return result;
                }
                await new Promise(resolve => setTimeout(resolve, timeout));

                if (this.isComponentMounted) {
                    this.setState({ count: result.length });
                    const newTimeout =
                        timeout + 250 > 3000 ? 1000 : timeout + 250;
                    return this.getVestingDelegationsRecursive(
                        result,
                        newTimeout
                    );
                }
            }
            return result;
        } catch (error) {
            console.log(error);
            return result;
        }
    };

    render() {
        const {
            delegatee,
            sortBy,
            sort,
            isSmallScreen,
            currentPage,
            indefiniteLoading,
            count,
        } = this.state;

        const {
            account,
            currentUser,
            vestingDelegations,
            totalVestingFund,
            totalVestingShares,
            vestingDelegationsPending,
            revokeDelegation,
            getVestingDelegations,
            setVestingDelegations,
            vestingDelegationsLoading,
        } = this.props;

        const offset = (currentPage - 1) * PAGE_LIMIT;

        const updateClipboard = value => {
            if (window.location.protocol === 'https:') {
                navigator.clipboard.writeText(value).then(
                    () => {
                        console.log(value);
                    },
                    () => console.error('error.')
                );
            }
        };

        const convertVestsToSteem = vests => {
            return ((vests * totalVestingFund) / totalVestingShares).toFixed(3);
        };

        const isMyAccount =
            currentUser && currentUser.get('username') === account.get('name');
        // do not render if account is not loaded or available
        if (!account) return null;

        // do not render if state appears to contain only lite account info
        if (!account.has('vesting_shares')) return null;

        const showTransferHandler = d => {
            const accountName = account.get('name');

            const refetchCB = () => {
                try {
                    const { auxiliaryData, currentPage } = this.state;
                    vestingDelegationsLoading(true);
                    const data = auxiliaryData.filter(
                        item => item.delegatee !== d
                    );
                    if (
                        currentPage !== 1 &&
                        d === auxiliaryData[auxiliaryData.length - 1].delegatee
                    ) {
                        this.setState({ currentPage: currentPage - 1 });
                    }
                    this.setState({ auxiliaryData: data });
                    this.updateVestingDelegations(data);
                } catch (error) {
                    console.log(error);
                }
            };
            revokeDelegation(accountName, d, refetchCB);
        };

        return (
            <div className="OutgoingDelegations">
                <div className="row filter-menu">
                    <div className="input-box">
                        <input
                            className={delegatee ? 'focus' : ''}
                            type="text"
                            id="delegatee"
                            name="delegatee"
                            placeholder={tt(
                                'outgoingdelegations_jsx.filters.search_delegatee'
                            )}
                            value={delegatee}
                            onChange={this.handleFindAccounts}
                        />
                    </div>
                </div>
                <div className="OutgoingDelegations__table-container">
                    {vestingDelegationsPending ? (
                        <table>
                            <tbody>
                                <tr>
                                    <td style={{ textAlign: 'center' }}>
                                        <LoadingIndicator type="circle" />
                                        {indefiniteLoading ? (
                                            <span>
                                                {`${tt(
                                                    'outgoingdelegations_jsx.load_accounts'
                                                )} ${count}`}
                                            </span>
                                        ) : (
                                            <div />
                                        )}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    ) : vestingDelegations ? (
                        <div>
                            {isSmallScreen ? (
                                <SmallTable
                                    sortData={this.sortData}
                                    vestingDelegations={
                                        vestingDelegations.length > PAGE_LIMIT
                                            ? vestingDelegations.slice(
                                                  offset,
                                                  offset + PAGE_LIMIT
                                              )
                                            : vestingDelegations
                                    }
                                    sortBy={sortBy}
                                    sort={sort}
                                    isMyAccount={isMyAccount}
                                    convertVestsToSteem={convertVestsToSteem}
                                    updateClipboard={updateClipboard}
                                    showTransferHandler={showTransferHandler}
                                    total={vestingDelegations.length}
                                />
                            ) : (
                                <Table
                                    sortData={this.sortData}
                                    vestingDelegations={
                                        vestingDelegations.length > PAGE_LIMIT
                                            ? vestingDelegations.slice(
                                                  offset,
                                                  offset + PAGE_LIMIT
                                              )
                                            : vestingDelegations
                                    }
                                    sortBy={sortBy}
                                    sort={sort}
                                    isMyAccount={isMyAccount}
                                    convertVestsToSteem={convertVestsToSteem}
                                    updateClipboard={updateClipboard}
                                    showTransferHandler={showTransferHandler}
                                    total={vestingDelegations.length}
                                />
                            )}
                            {vestingDelegations.length > PAGE_LIMIT ? (
                                <Pagination
                                    totalRecords={vestingDelegations.length}
                                    pageLimit={PAGE_LIMIT}
                                    pageNeighbours={1}
                                    onPageChanged={this.onPageChanged}
                                />
                            ) : (
                                <div />
                            )}
                        </div>
                    ) : (
                        <table>
                            <tbody>
                                <tr>
                                    <td style={{ textAlign: 'center' }}>
                                        {tt(
                                            'outgoingdelegations_jsx.no_delegations'
                                        )}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        );
    }
}
export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const vestingDelegations = state.user.get('vestingDelegations');

        const vestingDelegationsPending = state.user.get(
            'vestingDelegationsLoading'
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
            vestingDelegations,
            totalVestingShares,
            totalVestingFund,
            vestingDelegationsPending,
        };
    },
    // mapDispatchToProps
    dispatch => ({
        getVestingDelegations: (account, successCallback) => {
            dispatch(
                userActions.getVestingDelegations({ account, successCallback })
            );
        },
        setVestingDelegations: payload => {
            dispatch(userActions.setVestingDelegations(payload));
        },
        vestingDelegationsLoading: payload => {
            dispatch(userActions.vestingDelegationsLoading(payload));
        },
        revokeDelegation: (username, to, refetchDelegations) => {
            const vests = parseFloat(0, 10).toFixed(6);
            const operation = {
                delegator: username,
                delegatee: to,
                vesting_shares: `${vests} VESTS`,
            };

            const confirm = () => (
                <ConfirmDelegationTransfer operation={operation} amount={0.0} />
            );

            const transactionType = 'delegate_vesting_shares';
            const successCallback = () => {
                dispatch(
                    appActions.addNotification({
                        key: 'Revoke Delegation',
                        message: 'Delegation Successfully Revoked.',
                    })
                );
                refetchDelegations();
            };
            const errorCallback = () => {
                dispatch(
                    appActions.addNotification({
                        key: 'Revoke Delegation',
                        message: 'Revoke Operation Failed.',
                    })
                );
            };

            dispatch(
                transactionActions.broadcastOperation({
                    type: transactionType,
                    operation,
                    successCallback,
                    errorCallback,
                    confirm,
                })
            );
        },
    })
)(OutgoingDelegations);
