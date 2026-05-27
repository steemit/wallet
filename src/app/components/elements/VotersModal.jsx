import React from 'react';
import ReactModal from 'react-modal';
import tt from 'counterpart';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import SmallTable from 'app/components/elements/VotersTable/SmallTable';
import Table from 'app/components/elements/VotersTable/Table';
import Pagination from 'app/components/elements/OutgoingDelegationsTables/Pagination';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import {
    ASC,
    DESC,
    ACCOUNT,
    OWN_SP,
    PROXY_SP,
    PAGE_LIMIT,
    TOTAL_SP,
    INFLUENCE,
} from 'app/components/elements/VotersTable/constants';
import NumAbbr from 'number-abbreviate';
import CloseButton from 'app/components/elements/CloseButton';

const numAbbr = new NumAbbr();

ReactModal.defaultStyles.overlay.backgroundColor = 'rgba(0, 0, 0, 0.6)';

class VotersModal extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'VotersModal');
        this.isComponentMounted = false;
        this.state = {
            sortBy: '',
            sort: DESC,
            auxiliaryData: '',
            isSmallScreen: false,
            currentPage: 1,
            sortDataAux: [],
            totalEffectiveVotes: '0.00',
            voterAccountSearch: '',
        };
    }

    componentDidMount() {
        this.isComponentMounted = true;
        const { props } = this;
        window.addEventListener('resize', this.handleResize);
        this.handleResize();
        this.updateVotersAccount(props.sort_merged_total_sp);
    }

    componentDidUpdate(prevProps, prevState) {
        if (
            prevProps.sort_merged_total_sp !== this.props.sort_merged_total_sp
        ) {
            this.updateVotersAccount(this.props.sort_merged_total_sp);
            const total_sp_votes = this.props.total_sp_votes;
            const calculate = !(
                typeof total_sp_votes === 'string' && total_sp_votes
            );
            this.calculateTotalEffectiveVotes(calculate);
        }
    }

    componentWillUnmount() {
        window.removeEventListener('resize', this.handleResize);
        this.isComponentMounted = false;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
    }

    handleFindVoterAccounts = e => {
        const { value } = e.target;
        const { currentPage } = this.state;
        const auxiliaryData = this.props.sort_merged_total_sp;
        const currentValue = value.replace(/\s/g, '').toLowerCase();
        this.setState({
            voterAccountSearch: currentValue,
            sortBy: '',
            sort: DESC,
        });
        let data = auxiliaryData;
        data = data.filter(a => a[0].toLowerCase().includes(currentValue));
        if (currentPage !== 1) {
            this.setState({ currentPage: 1 });
        }
        this.updateVotersAccount(data);
    };

    sortData = (field, baseData = null) => {
        const { sortBy, sort } = this.state;
        const { sort_merged_total_sp } = this.props;
        let data = baseData ? baseData : sort_merged_total_sp;
        const sortMethod = sortBy !== field ? ASC : sort === ASC ? DESC : ASC;
        switch (field) {
            case OWN_SP:
                data =
                    sortMethod === ASC
                        ? data.sort(
                              (a, b) =>
                                  parseFloat(a[2].toFixed(2)) -
                                  parseFloat(b[2].toFixed(2))
                          )
                        : data.sort(
                              (a, b) =>
                                  parseFloat(b[2].toFixed(2)) -
                                  parseFloat(a[2].toFixed(2))
                          );
                break;
            case ACCOUNT:
                data =
                    sortMethod === ASC
                        ? data.sort((a, b) => {
                              const accountA = a[0].toLowerCase();
                              const accountB = b[0].toLowerCase();
                              if (accountA < accountB) {
                                  return -1;
                              }
                              if (accountA > accountB) {
                                  return 1;
                              }
                              return 0;
                          })
                        : data.sort((a, b) => {
                              const accountA = a[0].toLowerCase();
                              const accountB = b[0].toLowerCase();
                              if (accountA < accountB) {
                                  return 1;
                              }
                              if (accountA > accountB) {
                                  return -1;
                              }
                              return 0;
                          });
                break;
            case PROXY_SP:
                data =
                    sortMethod === ASC
                        ? data.sort(
                              (a, b) =>
                                  parseFloat(a[3].toFixed(2)) -
                                  parseFloat(b[3].toFixed(2))
                          )
                        : data.sort(
                              (a, b) =>
                                  parseFloat(b[3].toFixed(2)) -
                                  parseFloat(a[3].toFixed(2))
                          );
                break;
            case TOTAL_SP:
                data =
                    sortMethod === ASC
                        ? data.sort(
                              (a, b) =>
                                  parseFloat(a[1].toFixed(2)) -
                                  parseFloat(b[1].toFixed(2))
                          )
                        : data.sort(
                              (a, b) =>
                                  parseFloat(b[1].toFixed(2)) -
                                  parseFloat(a[1].toFixed(2))
                          );
                break;
            case INFLUENCE:
                data =
                    sortMethod === ASC
                        ? data.sort(
                              (a, b) =>
                                  parseFloat(a[6].toFixed(2)) -
                                  parseFloat(b[6].toFixed(2))
                          )
                        : data.sort(
                              (a, b) =>
                                  parseFloat(b[6].toFixed(2)) -
                                  parseFloat(a[6].toFixed(2))
                          );
                break;
            default:
                break;
        }
        this.setState({ sortBy: field, sort: sortMethod, currentPage: 1 });
        this.updateVotersAccount(data);
    };

    handleResize = () => {
        this.setState({ isSmallScreen: window.innerWidth <= 650 });
    };

    updateVotersAccount = res => {
        this.setState({ sortDataAux: res });
    };

    calculateTotalEffectiveVotes = (calculate = true) => {
        const sort_merged_total_sp = this.props.sort_merged_total_sp;
        let totalEffectiveVotes = 0;
        try {
            if (calculate && Array.isArray(sort_merged_total_sp)) {
                sort_merged_total_sp.forEach(item => {
                    const total_sp = item[1];
                    const proxy_name = item[4];
                    const proxy_vote = item[5];
                    if (!proxy_name && total_sp) {
                        totalEffectiveVotes += total_sp;
                    }
                });
            }
            this.setState({
                totalEffectiveVotes: totalEffectiveVotes.toFixed(2),
            });
        } catch (error) {
            this.setState({ totalEffectiveVotes: '0.00' });
        }
    };

    onPageChanged = dt => {
        this.setState({ currentPage: dt.currentPage });
    };

    totalVotes = (abbreviate = false) => {
        const totalEffectiveVotes = this.state.totalEffectiveVotes;
        const total_sp_votes = this.props.total_sp_votes;
        let total_votes = '0.00';
        try {
            total_votes =
                typeof total_sp_votes === 'string' && total_sp_votes
                    ? total_sp_votes
                    : typeof totalEffectiveVotes === 'string' &&
                      totalEffectiveVotes
                        ? totalEffectiveVotes
                        : '0';
        } catch (error) {}
        if (abbreviate) {
            return abbreviateNumber(total_votes);
        }
        return total_votes;
    };

    render() {
        const {
            sortBy,
            sort,
            isSmallScreen,
            currentPage,
            sortDataAux,
            totalEffectiveVotes,
            voterAccountSearch,
        } = this.state;

        const {
            open_modal,
            close_modal,
            is_voters_data_loaded,
            new_id,
            nightmodeEnabled,
        } = this.props;

        const offset = (currentPage - 1) * PAGE_LIMIT;

        return (
            <div className="voters-modal__container">
                <ReactModal
                    isOpen={open_modal}
                    onAfterOpen={open_modal}
                    onRequestClose={close_modal}
                    className={
                        nightmodeEnabled
                            ? 'VotersModal__content--night'
                            : 'VotersModal__content'
                    }
                    ariaHideApp={false}
                >
                    <CloseButton onClick={close_modal} />
                    {is_voters_data_loaded === false ? (
                        <div className="voters-modal__loader">
                            <LoadingIndicator type="dots" />
                        </div>
                    ) : (
                        <div className="voters-modal__header">
                            <header className="header">
                                <h4>
                                    Votes on proposal&nbsp;
                                    <span className="header__id">
                                        #{new_id}
                                    </span>
                                </h4>
                                <span title={`${this.totalVotes()} SP`}>
                                    {tt(
                                        'proposals.voters.header_proposal_msg',
                                        {
                                            total_votes: sortDataAux.length,
                                            total_sp_votes: this.totalVotes(
                                                true
                                            ),
                                        }
                                    )}
                                </span>
                                <br />
                                <span className="voters-highlight-container">
                                    <span className="voters-highlight-box voters-highlight-no-influence" />
                                    {tt(
                                        'proposals.voters.highlighted_proxy_no_influence'
                                    )}
                                </span>
                                <br />

                                <span className="voters-highlight-container">
                                    <span className="voters-highlight-box voters-highlight-influence-only" />
                                    {tt(
                                        'proposals.voters.highlighted_proxy_influence_only'
                                    )}
                                </span>
                            </header>
                            <div className="voter-filter">
                                <input
                                    className={
                                        voterAccountSearch ? 'focus' : ''
                                    }
                                    type="text"
                                    id="voterAccountSearch"
                                    name="voterAccountSearch"
                                    placeholder="Search..."
                                    value={voterAccountSearch}
                                    onChange={this.handleFindVoterAccounts}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            e.target.blur();
                                        }
                                    }}
                                />
                            </div>
                            <div className="content">
                                <div className={`content__row content__row--proposal_votes ${nightmodeEnabled ? 'theme-dark' : ''}`}>
                                    {isSmallScreen ? (
                                        <SmallTable
                                            sortData={this.sortData}
                                            sortBy={sortBy}
                                            sort={sort}
                                            sortDataAux={
                                                sortDataAux.length > PAGE_LIMIT
                                                    ? sortDataAux.slice(
                                                          offset,
                                                          offset + PAGE_LIMIT
                                                      )
                                                    : sortDataAux
                                            }
                                            totalEffectiveVotes={
                                                totalEffectiveVotes
                                            }
                                            total={sortDataAux.length}
                                        />
                                    ) : (
                                        <Table
                                            sortData={this.sortData}
                                            total={sortDataAux.length}
                                            sortDataAux={
                                                sortDataAux.length > PAGE_LIMIT
                                                    ? sortDataAux.slice(
                                                          offset,
                                                          offset + PAGE_LIMIT
                                                      )
                                                    : sortDataAux
                                            }
                                            sortBy={sortBy}
                                            totalEffectiveVotes={
                                                totalEffectiveVotes
                                            }
                                            sort={sort}
                                        />
                                    )}
                                    {sortDataAux.length > PAGE_LIMIT ? (
                                        <Pagination
                                            totalRecords={sortDataAux.length}
                                            pageLimit={PAGE_LIMIT}
                                            pageNeighbours={1}
                                            onPageChanged={this.onPageChanged}
                                        />
                                    ) : (
                                        <div />
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </ReactModal>
            </div>
        );
    }
}
export default VotersModal;

function abbreviateNumber(number) {
    return numAbbr.abbreviate(number, 2);
}

function formatNumberWithWords(number, decimals = 2) {
    const absNum = Math.abs(number);
    const units = [
        { value: 1e9, suffix: 'billion' },
        { value: 1e6, suffix: 'million' },
        { value: 1e3, suffix: 'thousand' },
    ];
    try {
        const unit = units.find(unit => absNum >= unit.value);
        if (unit) {
            return (number / unit.value).toFixed(decimals) + ' ' + unit.suffix;
        }
    } catch (error) {
        return number;
    }
    return number;
}
